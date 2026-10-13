import { z } from 'zod';
import * as crypto from 'crypto';
import { ActionHandler, ActionContext, ActionResult } from '../automations.types';
import { CredentialVault } from '../../connectors/credential-vault';
import { SmtpProvider } from '../../connectors/providers/smtp.provider';
import { TemplateEngine, TemplateContext } from '../../templates/template-engine';

const configSchema = z.object({
  connectorId: z.string().optional(),
  templateId: z.string().optional(),
  toEmail: z.string().optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
  bodyHtml: z.string().optional(),
});

type Config = z.infer<typeof configSchema>;

export class SendEmailActionHandler implements ActionHandler<Config> {
  key = 'send_email';
  label = 'Send Email';
  configSchema = configSchema;
  requiresConnector = 'smtp';

  private readonly smtpProvider = new SmtpProvider();

  async execute(ctx: ActionContext, config: Config): Promise<ActionResult> {
    const start = Date.now();
    const sql = ctx.sql;

    if (!sql) {
      return {
        success: false,
        error: 'Database connection is missing in action context',
        durationMs: Date.now() - start,
      };
    }

    const recordId = ctx.record?.id || ctx.event.recordId;
    let targetEmail: string | undefined = config.toEmail ? ctx.resolve(config.toEmail) : undefined;

    if (!targetEmail) {
      const emailField = ctx.record?.data?.email || ctx.event.snapshot?.data?.email;
      if (emailField && typeof emailField === 'string') {
        targetEmail = emailField;
      }
    }

    if (!targetEmail || !targetEmail.trim()) {
      return {
        success: false,
        error: 'Recipient email address not found on record',
        durationMs: Date.now() - start,
      };
    }

    const cleanTo = targetEmail.trim().toLowerCase();

    const [suppressed] = await sql<any[]>`
      SELECT id
      FROM suppression_list
      WHERE org_id = ${ctx.orgId}
        AND address = ${cleanTo}
        AND channel = 'email'
      LIMIT 1
    `;

    if (suppressed) {
      return {
        success: false,
        error: `Recipient address ${cleanTo} is suppressed due to previous hard bounce or complaint`,
        durationMs: Date.now() - start,
      };
    }

    let connectorRow: any;
    if (config.connectorId) {
      const [c] = await sql<any[]>`
        SELECT *
        FROM connectors
        WHERE id = ${config.connectorId} AND org_id = ${ctx.orgId} AND is_active = true
      `;
      connectorRow = c;
    } else {
      const [c] = await sql<any[]>`
        SELECT *
        FROM connectors
        WHERE org_id = ${ctx.orgId} AND provider_key = 'smtp' AND is_active = true
        ORDER BY created_at ASC
        LIMIT 1
      `;
      connectorRow = c;
    }

    if (!connectorRow) {
      return {
        success: false,
        error: 'No active SMTP connector found for sending outbound email',
        durationMs: Date.now() - start,
      };
    }

    const decryptedCreds = CredentialVault.decrypt(connectorRow.credentials);
    const connConfig = connectorRow.config || {};
    const fromAddress = connConfig.fromAddress || 'notifications@crm.local';
    const fromName = connConfig.fromName;
    const formattedFrom = fromName ? `"${fromName}" <${fromAddress}>` : fromAddress;

    let finalSubject = config.subject ? ctx.resolve(config.subject) : 'Automated CRM Notification';
    let finalBodyText = config.body ? ctx.resolve(config.body) : '';
    let finalBodyHtml = config.bodyHtml ? ctx.resolve(config.bodyHtml) : undefined;

    if (config.templateId) {
      const [tpl] = await sql<any[]>`
        SELECT *
        FROM templates
        WHERE id = ${config.templateId} AND org_id = ${ctx.orgId} AND deleted_at IS NULL
      `;

      if (tpl) {
        let templateContext: TemplateContext = {
          record: {
            id: recordId || '',
            displayName: ctx.record?.displayName || ctx.event.snapshot?.display_name || '',
            data: ctx.record?.data || ctx.event.snapshot?.data || {},
            createdAt: new Date().toISOString(),
          },
          org: {
            name: 'Webingo HQ',
            slug: 'webingo',
          },
          link: {
            record: recordId ? `http://localhost:5173/records/${recordId}` : '',
            unsubscribe: `http://localhost:5173/unsubscribe?token=${recordId || ''}`,
          },
        };

        if (recordId) {
          const [rec] = await sql<any[]>`
            SELECT id, display_name, data, owner_id, created_at FROM records WHERE id = ${recordId}
          `;
          if (rec) {
            let ownerObj: any = undefined;
            if (rec.owner_id) {
              const [u] = await sql<any[]>`SELECT id, full_name, email FROM users WHERE id = ${rec.owner_id}`;
              if (u) {
                ownerObj = { id: u.id, fullName: u.full_name, email: u.email };
              }
            }
            templateContext = {
              record: {
                id: rec.id,
                displayName: rec.display_name,
                data: rec.data || {},
                createdAt: rec.created_at,
              },
              owner: ownerObj,
              org: {
                name: 'Webingo HQ',
                slug: 'webingo',
              },
              link: {
                record: `http://localhost:5173/records/${rec.id}`,
                unsubscribe: `http://localhost:5173/unsubscribe?token=${rec.id}`,
              },
            };
          }
        }

        finalSubject = TemplateEngine.render(config.subject || tpl.subject || 'Notification', templateContext);
        finalBodyText = TemplateEngine.render(config.body || tpl.body, templateContext);
      }
    }

    let threadId: string | null = null;
    let inReplyTo: string | null = null;

    if (recordId) {
      const [prev] = await sql<any[]>`
        SELECT thread_id, provider_message_id
        FROM messages
        WHERE org_id = ${ctx.orgId} AND record_id = ${recordId}
        ORDER BY created_at DESC
        LIMIT 1
      `;
      if (prev) {
        threadId = prev.thread_id;
        inReplyTo = prev.provider_message_id;
      }
    }

    if (!threadId) {
      threadId = crypto.randomUUID();
    }

    const domain = fromAddress.includes('@') ? fromAddress.split('@')[1] : 'crm.local';
    const messageUuid = crypto.randomUUID();
    const generatedMessageId = `<${messageUuid}@${domain}>`;

    const headers: Record<string, string> = {
      'List-Unsubscribe': `<http://localhost:5173/unsubscribe?token=${recordId || ''}>`,
    };

    if (inReplyTo) {
      headers['In-Reply-To'] = inReplyTo;
      headers['References'] = inReplyTo;
    }

    try {
      const transporter = this.smtpProvider.createTransport(connConfig, decryptedCreds);
      const sendResult = await transporter.sendMail({
        from: formattedFrom,
        to: cleanTo,
        subject: finalSubject,
        text: finalBodyText,
        html: finalBodyHtml,
        messageId: generatedMessageId,
        headers,
      });

      const finalProviderId = sendResult.messageId || generatedMessageId;

      const [insertedMessage] = await sql<any[]>`
        INSERT INTO messages (
          org_id,
          record_id,
          thread_id,
          channel,
          direction,
          connector_id,
          from_address,
          to_address,
          subject,
          body_text,
          body_html,
          template_id,
          provider_message_id,
          in_reply_to,
          status
        ) VALUES (
          ${ctx.orgId},
          ${recordId || null},
          ${threadId},
          'email',
          'outbound',
          ${connectorRow.id},
          ${fromAddress},
          ${cleanTo},
          ${finalSubject},
          ${finalBodyText},
          ${finalBodyHtml || null},
          ${config.templateId || null},
          ${finalProviderId},
          ${inReplyTo || null},
          'sent'
        )
        RETURNING id
      `;

      if (recordId) {
        const [rec] = await sql<any[]>`
          SELECT module_id FROM records WHERE id = ${recordId}
        `;
        if (rec) {
          await sql`
            INSERT INTO record_events (
              org_id,
              record_id,
              module_id,
              type,
              actor_id,
              actor_type,
              changes,
              payload
            ) VALUES (
              ${ctx.orgId},
              ${recordId},
              ${rec.module_id},
              'message.sent',
              NULL,
              'automation',
              ${JSON.stringify({ channel: 'email', direction: 'outbound' })}::text::jsonb,
              ${JSON.stringify({
                messageId: insertedMessage.id,
                threadId,
                subject: finalSubject,
                to: cleanTo,
                providerMessageId: finalProviderId,
              })}::text::jsonb
            )
          `;
        }
      }

      return {
        success: true,
        responseBody: {
          messageId: insertedMessage.id,
          providerMessageId: finalProviderId,
          threadId,
          recipient: cleanTo,
          subject: finalSubject,
        },
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'SMTP delivery failed',
        durationMs: Date.now() - start,
      };
    }
  }
}

export const sendEmailAction = new SendEmailActionHandler();
