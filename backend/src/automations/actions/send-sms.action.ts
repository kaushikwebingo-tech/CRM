import { z } from 'zod';
import * as crypto from 'crypto';
import { ActionHandler, ActionContext, ActionResult } from '../automations.types';
import { CredentialVault } from '../../connectors/credential-vault';
import { Msg91Provider } from '../../connectors/providers/msg91.provider';
import { TwilioProvider } from '../../connectors/providers/twilio.provider';
import { TemplateEngine, TemplateContext } from '../../templates/template-engine';

const configSchema = z.object({
  connectorId: z.string().optional(),
  templateId: z.string().optional(),
  dltTemplateId: z.string().optional(),
  dltHeader: z.string().optional(),
  toPhone: z.string().optional(),
  message: z.string().optional(),
  purpose: z.enum(['utility', 'marketing', 'transactional']).default('utility'),
});

type Config = z.infer<typeof configSchema>;

export class SendSmsActionHandler implements ActionHandler<Config> {
  key = 'send_sms';
  label = 'Send SMS';
  configSchema = configSchema;
  requiresConnector = 'sms';

  private readonly msg91 = new Msg91Provider();
  private readonly twilio = new TwilioProvider();

  async execute(ctx: ActionContext, config: Config): Promise<ActionResult> {
    const start = Date.now();
    const sql = ctx.sql;

    if (!sql) {
      return {
        success: false,
        error: 'Database connection missing in action context',
        durationMs: Date.now() - start,
      };
    }

    const recordId = ctx.record?.id || ctx.event.recordId;
    let targetPhone: string | undefined = config.toPhone ? ctx.resolve(config.toPhone) : undefined;

    if (!targetPhone) {
      const phoneField =
        ctx.record?.data?.phone ||
        ctx.record?.data?.mobile ||
        ctx.event.snapshot?.data?.phone;
      if (phoneField && typeof phoneField === 'string') {
        targetPhone = phoneField;
      }
    }

    if (!targetPhone || !targetPhone.trim()) {
      return {
        success: false,
        error: 'Recipient phone number not found on record',
        durationMs: Date.now() - start,
      };
    }

    const cleanTo = targetPhone.replace(/[^\d\+]/g, '');

    const [suppressed] = await sql<any[]>`
      SELECT id
      FROM suppression_list
      WHERE org_id = ${ctx.orgId}
        AND address = ${cleanTo}
        AND channel = 'sms'
      LIMIT 1
    `;

    if (suppressed) {
      return {
        success: false,
        error: `Recipient phone ${cleanTo} is suppressed due to previous opt-out`,
        durationMs: Date.now() - start,
      };
    }

    const purpose = config.purpose || 'utility';

    if (recordId) {
      const [consent] = await sql<any[]>`
        SELECT status
        FROM consents
        WHERE org_id = ${ctx.orgId}
          AND record_id = ${recordId}
          AND channel = 'sms'
          AND (purpose = ${purpose} OR purpose = 'marketing')
        ORDER BY created_at DESC
        LIMIT 1
      `;

      if (purpose === 'marketing') {
        if (!consent || consent.status !== 'granted') {
          return {
            success: false,
            error: `Consent is required for marketing SMS messages to ${cleanTo} but has not been granted`,
            durationMs: Date.now() - start,
          };
        }
      } else if (consent && consent.status === 'withdrawn') {
        return {
          success: false,
          error: `Recipient ${cleanTo} has explicitly withdrawn consent for SMS communications`,
          durationMs: Date.now() - start,
        };
      }
    }

    let connectorRow: any;
    if (config.connectorId) {
      const [c] = await sql<any[]>`
        SELECT *
        FROM connectors
        WHERE id = ${config.connectorId}
          AND org_id = ${ctx.orgId}
          AND is_active = true
      `;
      connectorRow = c;
    } else {
      const [c] = await sql<any[]>`
        SELECT *
        FROM connectors
        WHERE org_id = ${ctx.orgId}
          AND provider_key IN ('msg91', 'twilio')
          AND is_active = true
        ORDER BY created_at ASC
        LIMIT 1
      `;
      connectorRow = c;
    }

    if (!connectorRow) {
      return {
        success: false,
        error: 'No active SMS connector (msg91 or twilio) found for this organization',
        durationMs: Date.now() - start,
      };
    }

    let creds: any;
    try {
      creds = CredentialVault.decrypt(connectorRow.credentials);
    } catch {
      return {
        success: false,
        error: 'Failed to decrypt SMS connector credentials from vault',
        durationMs: Date.now() - start,
      };
    }

    let sendBody = config.message ? ctx.resolve(config.message) : '';
    let dltTemplateId = config.dltTemplateId;
    let dltHeader = config.dltHeader || connectorRow.config?.senderId;

    if (config.templateId) {
      const [tpl] = await sql<any[]>`
        SELECT *
        FROM templates
        WHERE id = ${config.templateId}
          AND org_id = ${ctx.orgId}
          AND deleted_at IS NULL
      `;

      if (!tpl) {
        return {
          success: false,
          error: `SMS template ${config.templateId} not found`,
          durationMs: Date.now() - start,
        };
      }

      dltTemplateId = dltTemplateId || tpl.dlt_template_id;
      dltHeader = dltHeader || tpl.dlt_header;

      let ownerRow: any = null;
      const ownerId = ctx.record?.ownerId || ctx.event.snapshot?.owner_id;
      if (ownerId) {
        const [u] = await sql<any[]>`SELECT id, full_name, email FROM users WHERE id = ${ownerId}`;
        ownerRow = u;
      }

      const [orgRow] = await sql<any[]>`SELECT id, name FROM organizations WHERE id = ${ctx.orgId}`;

      const tplContext: TemplateContext = {
        record: {
          id: recordId || '',
          displayName: ctx.record?.displayName || ctx.event.snapshot?.display_name || '',
          data: ctx.record?.data || ctx.event.snapshot?.data || {},
        },
        owner: ownerRow ? { id: ownerRow.id, fullName: ownerRow.full_name, email: ownerRow.email } : undefined,
        org: orgRow ? { name: orgRow.name } : undefined,
        link: {
          record: recordId ? `http://localhost:5173/records/${recordId}` : '',
          unsubscribe: `http://localhost:5173/unsubscribe?token=${recordId || ''}`,
        },
      };

      sendBody = TemplateEngine.render(tpl.body, tplContext);
    }

    let sendResult: { messageId: string; rawResponse: any };
    try {
      if (connectorRow.provider_key === 'msg91') {
        sendResult = await this.msg91.sendSms(connectorRow.config || {}, creds, {
          to: cleanTo,
          message: sendBody,
          dltTemplateId,
          dltHeader,
        });
      } else {
        sendResult = await this.twilio.sendSms(connectorRow.config || {}, creds, {
          to: cleanTo,
          message: sendBody,
        });
      }
    } catch (err: any) {
      return {
        success: false,
        error: `SMS API error: ${err.message || String(err)}`,
        durationMs: Date.now() - start,
      };
    }

    let threadId = crypto.randomUUID();
    if (recordId) {
      const [th] = await sql<any[]>`
        SELECT thread_id
        FROM messages
        WHERE org_id = ${ctx.orgId}
          AND record_id = ${recordId}
        ORDER BY created_at DESC
        LIMIT 1
      `;
      if (th?.thread_id) {
        threadId = th.thread_id;
      }
    }

    const [inserted] = await sql<any[]>`
      INSERT INTO messages (
        org_id,
        record_id,
        thread_id,
        channel,
        direction,
        connector_id,
        from_address,
        to_address,
        body_text,
        template_id,
        provider_message_id,
        status,
        metadata
      ) VALUES (
        ${ctx.orgId},
        ${recordId || null},
        ${threadId},
        'sms',
        'outbound',
        ${connectorRow.id},
        ${dltHeader || connectorRow.config?.fromNumber || 'SMS_SERVICE'},
        ${cleanTo},
        ${sendBody},
        ${config.templateId || null},
        ${sendResult.messageId},
        'sent',
        ${JSON.stringify({ rawResponse: sendResult.rawResponse, dltTemplateId, dltHeader })}::text::jsonb
      )
      RETURNING *
    `;

    if (recordId) {
      const [rec] = await sql<any[]>`SELECT module_id FROM records WHERE id = ${recordId}`;
      await sql`
        INSERT INTO record_events (
          org_id,
          record_id,
          module_id,
          type,
          actor_id,
          actor_type,
          payload
        ) VALUES (
          ${ctx.orgId},
          ${recordId},
          ${rec?.module_id || null},
          'message.sent',
          null,
          'system',
          ${JSON.stringify({
            channel: 'sms',
            messageId: inserted.id,
            providerMessageId: sendResult.messageId,
            to: cleanTo,
            threadId,
            templateId: config.templateId,
          })}::text::jsonb
        )
      `;
    }

    return {
      success: true,
      responseBody: {
        messageId: inserted.id,
        providerMessageId: sendResult.messageId,
        threadId,
        to: cleanTo,
      },
      durationMs: Date.now() - start,
    };
  }
}

export const sendSmsAction = new SendSmsActionHandler();
