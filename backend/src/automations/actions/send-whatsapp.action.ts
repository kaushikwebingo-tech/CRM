import { z } from 'zod';
import * as crypto from 'crypto';
import { ActionHandler, ActionContext, ActionResult } from '../automations.types';
import { CredentialVault } from '../../connectors/credential-vault';
import { WhatsAppCloudProvider } from '../../connectors/providers/whatsapp-cloud.provider';
import { TemplateEngine, TemplateContext } from '../../templates/template-engine';

const configSchema = z.object({
  connectorId: z.string().optional(),
  templateId: z.string().optional(),
  toPhone: z.string().optional(),
  message: z.string().optional(),
  purpose: z.enum(['utility', 'marketing', 'transactional']).default('utility'),
});

type Config = z.infer<typeof configSchema>;

export class SendWhatsAppActionHandler implements ActionHandler<Config> {
  key = 'send_whatsapp';
  label = 'Send WhatsApp';
  configSchema = configSchema;
  requiresConnector = 'whatsapp_cloud';

  private readonly whatsappProvider = new WhatsAppCloudProvider();

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
        ctx.record?.data?.whatsapp ||
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
        AND channel = 'whatsapp'
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
          AND channel = 'whatsapp'
          AND (purpose = ${purpose} OR purpose = 'marketing')
        ORDER BY created_at DESC
        LIMIT 1
      `;

      if (purpose === 'marketing') {
        if (!consent || consent.status !== 'granted') {
          return {
            success: false,
            error: `Consent is required for marketing WhatsApp messages to ${cleanTo} but has not been granted`,
            durationMs: Date.now() - start,
          };
        }
      } else if (consent && consent.status === 'withdrawn') {
        return {
          success: false,
          error: `Recipient ${cleanTo} has explicitly withdrawn consent for WhatsApp communications`,
          durationMs: Date.now() - start,
        };
      }
    }

    let isSessionWindowOpen = false;
    if (recordId) {
      const [windowRow] = await sql<any[]>`
        SELECT MAX(created_at) AS last_inbound
        FROM messages
        WHERE org_id = ${ctx.orgId}
          AND record_id = ${recordId}
          AND channel = 'whatsapp'
          AND direction = 'inbound'
      `;

      if (windowRow?.last_inbound) {
        const diffMs = Date.now() - new Date(windowRow.last_inbound).getTime();
        isSessionWindowOpen = diffMs < 24 * 60 * 60 * 1000;
      }
    }

    if (!isSessionWindowOpen && !config.templateId) {
      return {
        success: false,
        error: 'Free-form WhatsApp messages cannot be sent outside the 24-hour customer session window. An approved template is required.',
        durationMs: Date.now() - start,
      };
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
          AND provider_key = 'whatsapp_cloud'
          AND is_active = true
        ORDER BY created_at ASC
        LIMIT 1
      `;
      connectorRow = c;
    }

    if (!connectorRow) {
      return {
        success: false,
        error: 'No active Meta WhatsApp Cloud connector found for this organization',
        durationMs: Date.now() - start,
      };
    }

    let creds: any;
    try {
      creds = CredentialVault.decrypt(connectorRow.credentials);
    } catch {
      return {
        success: false,
        error: 'Failed to decrypt WhatsApp connector credentials from vault',
        durationMs: Date.now() - start,
      };
    }

    let sendBody = config.message ? ctx.resolve(config.message) : '';
    let templateName: string | undefined;

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
          error: `WhatsApp template ${config.templateId} not found`,
          durationMs: Date.now() - start,
        };
      }

      templateName = tpl.name;

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
      sendResult = await this.whatsappProvider.sendMessage(connectorRow.config || {}, creds, {
        to: cleanTo,
        text: sendBody,
        template: templateName ? { name: templateName } : undefined,
      });
    } catch (err: any) {
      return {
        success: false,
        error: `Meta WhatsApp API error: ${err.message || String(err)}`,
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
        'whatsapp',
        'outbound',
        ${connectorRow.id},
        ${connectorRow.config?.phoneNumberId || 'whatsapp_business'},
        ${cleanTo},
        ${sendBody},
        ${config.templateId || null},
        ${sendResult.messageId},
        'sent',
        ${JSON.stringify({ rawResponse: sendResult.rawResponse, sessionWindowOpen: isSessionWindowOpen })}::text::jsonb
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
            channel: 'whatsapp',
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
        sessionWindowOpen: isSessionWindowOpen,
      },
      durationMs: Date.now() - start,
    };
  }
}

export const sendWhatsAppAction = new SendWhatsAppActionHandler();
