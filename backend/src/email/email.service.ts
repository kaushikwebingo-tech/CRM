import { Injectable, Inject } from '@nestjs/common';
import * as crypto from 'crypto';
import postgres from 'postgres';
import { PG_CLIENT } from '../db/connection';
import { NotFoundError, ValidationError } from '../common/errors';
import { CredentialVault } from '../connectors/credential-vault';
import { SmtpProvider } from '../connectors/providers/smtp.provider';
import { TemplateEngine } from '../templates/template-engine';
import { TemplatesService } from '../templates/templates.service';
import { SuppressionService } from './suppression.service';
import { stripQuotedHistory } from './quote-stripper';
import {
  MessageItem,
  OutboundEmailDto,
  InboundEmailInput,
  BounceEventInput,
} from './email.types';

@Injectable()
export class EmailService {
  private readonly smtpProvider = new SmtpProvider();

  constructor(
    @Inject(PG_CLIENT) private readonly sql: postgres.Sql,
    private readonly suppressionService: SuppressionService,
    private readonly templatesService: TemplatesService,
  ) {}

  async sendOutbound(orgId: string, dto: OutboundEmailDto): Promise<MessageItem> {
    if (!dto.toEmail || !dto.toEmail.trim()) {
      throw new ValidationError('Recipient email address is required', [
        { field: 'toEmail', message: 'Recipient email is required' },
      ]);
    }

    const cleanTo = dto.toEmail.trim().toLowerCase();

    const isSuppressed = await this.suppressionService.isSuppressed(orgId, cleanTo, 'email');
    if (isSuppressed) {
      throw new ValidationError(`Recipient address ${cleanTo} is suppressed due to previous hard bounce or complaint`, [
        { field: 'toEmail', message: 'Address suppressed' },
      ]);
    }

    let connectorRow: any;
    if (dto.connectorId) {
      const [c] = await this.sql<any[]>`
        SELECT *
        FROM connectors
        WHERE id = ${dto.connectorId} AND org_id = ${orgId} AND is_active = true
      `;
      if (!c) {
        throw new NotFoundError(`Active connector ${dto.connectorId} not found`);
      }
      connectorRow = c;
    } else {
      const [c] = await this.sql<any[]>`
        SELECT *
        FROM connectors
        WHERE org_id = ${orgId} AND provider_key = 'smtp' AND is_active = true
        ORDER BY created_at ASC
        LIMIT 1
      `;
      if (!c) {
        throw new NotFoundError('No active SMTP connector found for organization');
      }
      connectorRow = c;
    }

    const decryptedCreds = CredentialVault.decrypt(connectorRow.credentials);
    const connectorConfig = connectorRow.config || {};
    const fromAddress = connectorConfig.fromAddress || 'notifications@crm.local';
    const fromName = connectorConfig.fromName;
    const formattedFrom = fromName ? `"${fromName}" <${fromAddress}>` : fromAddress;

    let finalSubject = dto.subject || '';
    let finalBodyText = dto.bodyText || '';
    let finalBodyHtml = dto.bodyHtml || undefined;

    if (dto.templateId) {
      const [tpl] = await this.sql<any[]>`
        SELECT *
        FROM templates
        WHERE id = ${dto.templateId} AND org_id = ${orgId} AND deleted_at IS NULL
      `;
      if (!tpl) {
        throw new NotFoundError(`Template ${dto.templateId} not found`);
      }

      if (dto.recordId) {
        const { context } = await this.templatesService.buildContext(orgId, dto.recordId);
        finalSubject = TemplateEngine.render(dto.subject || tpl.subject || 'Notification', context);
        finalBodyText = TemplateEngine.render(dto.bodyText || tpl.body, context);
      } else {
        finalSubject = dto.subject || tpl.subject || 'Notification';
        finalBodyText = dto.bodyText || tpl.body;
      }
    }

    let threadId = dto.threadId;
    if (!threadId && dto.inReplyTo) {
      const [prev] = await this.sql<any[]>`
        SELECT thread_id, record_id
        FROM messages
        WHERE org_id = ${orgId}
          AND (provider_message_id = ${dto.inReplyTo} OR id::text = ${dto.inReplyTo})
        LIMIT 1
      `;
      if (prev) {
        threadId = prev.thread_id;
        if (!dto.recordId && prev.record_id) {
          dto.recordId = prev.record_id;
        }
      }
    }

    if (!threadId && dto.recordId) {
      const [prev] = await this.sql<any[]>`
        SELECT thread_id
        FROM messages
        WHERE org_id = ${orgId} AND record_id = ${dto.recordId}
        ORDER BY created_at DESC
        LIMIT 1
      `;
      if (prev) {
        threadId = prev.thread_id;
      }
    }

    if (!threadId) {
      threadId = crypto.randomUUID();
    }

    const domain = fromAddress.includes('@') ? fromAddress.split('@')[1] : 'crm.local';
    const messageUuid = crypto.randomUUID();
    const generatedMessageId = `<${messageUuid}@${domain}>`;

    const headers: Record<string, string> = {
      ...(dto.headers || {}),
      'List-Unsubscribe': `<http://localhost:5173/unsubscribe?record=${dto.recordId || ''}>`,
    };

    if (dto.inReplyTo) {
      headers['In-Reply-To'] = dto.inReplyTo;
      headers['References'] = dto.inReplyTo;
    }

    const transporter = this.smtpProvider.createTransport(connectorConfig, decryptedCreds);
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

    const [createdMessage] = await this.sql<MessageItem[]>`
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
        status,
        sent_by,
        automation_run_id
      ) VALUES (
        ${orgId},
        ${dto.recordId || null},
        ${threadId},
        'email',
        'outbound',
        ${connectorRow.id},
        ${fromAddress},
        ${cleanTo},
        ${finalSubject},
        ${finalBodyText},
        ${finalBodyHtml || null},
        ${dto.templateId || null},
        ${finalProviderId},
        ${dto.inReplyTo || null},
        'sent',
        ${dto.sentBy || null},
        ${dto.automationRunId || null}
      )
      RETURNING
        id,
        org_id as "orgId",
        record_id as "recordId",
        thread_id as "threadId",
        channel,
        direction,
        connector_id as "connectorId",
        from_address as "fromAddress",
        to_address as "toAddress",
        subject,
        body_text as "bodyText",
        body_html as "bodyHtml",
        attachments,
        template_id as "templateId",
        provider_message_id as "providerMessageId",
        in_reply_to as "inReplyTo",
        status,
        status_detail as "statusDetail",
        sent_by as "sentBy",
        automation_run_id as "automationRunId",
        created_at as "createdAt"
    `;

    if (dto.recordId) {
      const [rec] = await this.sql<any[]>`
        SELECT module_id FROM records WHERE id = ${dto.recordId}
      `;
      if (rec) {
        await this.sql`
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
            ${orgId},
            ${dto.recordId},
            ${rec.module_id},
            'message.sent',
            ${dto.sentBy || null},
            ${dto.sentBy ? 'user' : 'automation'},
            ${JSON.stringify({ channel: 'email', direction: 'outbound' })}::text::jsonb,
            ${JSON.stringify({
              messageId: createdMessage.id,
              threadId,
              subject: finalSubject,
              to: cleanTo,
              providerMessageId: finalProviderId,
            })}::text::jsonb
          )
        `;
      }
    }

    return createdMessage;
  }

  async processInbound(orgId: string, input: InboundEmailInput): Promise<MessageItem> {
    const fromAddress = input.from.trim().toLowerCase();
    const toAddress = input.to.trim().toLowerCase();
    const messageId = input.messageId || `<${crypto.randomUUID()}@inbound.crm>`;

    if (input.connectorId && input.messageId) {
      const [existing] = await this.sql<MessageItem[]>`
        SELECT
          id,
          org_id as "orgId",
          record_id as "recordId",
          thread_id as "threadId",
          channel,
          direction,
          connector_id as "connectorId",
          from_address as "fromAddress",
          to_address as "toAddress",
          subject,
          body_text as "bodyText",
          body_html as "bodyHtml",
          attachments,
          template_id as "templateId",
          provider_message_id as "providerMessageId",
          in_reply_to as "inReplyTo",
          status,
          status_detail as "statusDetail",
          sent_by as "sentBy",
          automation_run_id as "automationRunId",
          created_at as "createdAt"
        FROM messages
        WHERE connector_id = ${input.connectorId}
          AND provider_message_id = ${input.messageId}
        LIMIT 1
      `;
      if (existing) {
        return existing;
      }
    }

    let resolvedRecordId: string | null = null;
    let resolvedThreadId: string | null = null;

    if (input.inReplyTo || input.references) {
      const refs = [input.inReplyTo, input.references]
        .filter(Boolean)
        .flatMap((r) => r!.split(/\s+/))
        .map((r) => r.trim())
        .filter(Boolean);

      for (const ref of refs) {
        const [matched] = await this.sql<any[]>`
          SELECT thread_id, record_id
          FROM messages
          WHERE org_id = ${orgId}
            AND provider_message_id = ${ref}
          LIMIT 1
        `;
        if (matched) {
          resolvedThreadId = matched.thread_id;
          resolvedRecordId = matched.record_id;
          break;
        }
      }
    }

    if (!resolvedRecordId) {
      const [matchedRecord] = await this.sql<any[]>`
        SELECT id
        FROM records
        WHERE org_id = ${orgId}
          AND lower(data->>'email') = ${fromAddress}
          AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `;
      if (matchedRecord) {
        resolvedRecordId = matchedRecord.id;
        const [prev] = await this.sql<any[]>`
          SELECT thread_id
          FROM messages
          WHERE org_id = ${orgId} AND record_id = ${matchedRecord.id}
          ORDER BY created_at DESC
          LIMIT 1
        `;
        if (prev) {
          resolvedThreadId = prev.thread_id;
        }
      }
    }

    if (!resolvedThreadId) {
      resolvedThreadId = crypto.randomUUID();
    }

    const cleanText = stripQuotedHistory(input.text);

    const [createdMessage] = await this.sql<MessageItem[]>`
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
        attachments,
        provider_message_id,
        in_reply_to,
        status
      ) VALUES (
        ${orgId},
        ${resolvedRecordId},
        ${resolvedThreadId},
        'email',
        'inbound',
        ${input.connectorId || null},
        ${fromAddress},
        ${toAddress},
        ${input.subject || null},
        ${cleanText},
        ${input.html || null},
        ${JSON.stringify(input.attachments || [])}::text::jsonb,
        ${messageId},
        ${input.inReplyTo || null},
        'delivered'
      )
      RETURNING
        id,
        org_id as "orgId",
        record_id as "recordId",
        thread_id as "threadId",
        channel,
        direction,
        connector_id as "connectorId",
        from_address as "fromAddress",
        to_address as "toAddress",
        subject,
        body_text as "bodyText",
        body_html as "bodyHtml",
        attachments,
        template_id as "templateId",
        provider_message_id as "providerMessageId",
        in_reply_to as "inReplyTo",
        status,
        status_detail as "statusDetail",
        sent_by as "sentBy",
        automation_run_id as "automationRunId",
        created_at as "createdAt"
    `;

    if (resolvedRecordId) {
      const [rec] = await this.sql<any[]>`
        SELECT module_id FROM records WHERE id = ${resolvedRecordId}
      `;
      if (rec) {
        await this.sql`
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
            ${orgId},
            ${resolvedRecordId},
            ${rec.module_id},
            'message.received',
            NULL,
            'system',
            ${JSON.stringify({ channel: 'email', direction: 'inbound' })}::text::jsonb,
            ${JSON.stringify({
              messageId: createdMessage.id,
              threadId: resolvedThreadId,
              from: fromAddress,
              subject: input.subject,
              preview: cleanText.slice(0, 150),
            })}::text::jsonb
          )
        `;
      }
    }

    return createdMessage;
  }

  async processBounce(orgId: string, input: BounceEventInput) {
    const cleanEmail = input.email.trim().toLowerCase();

    if (input.bounceType === 'hard' || input.bounceType === 'complaint') {
      await this.suppressionService.suppress(
        orgId,
        cleanEmail,
        input.bounceType === 'complaint' ? 'complaint' : 'hard_bounce',
        input.reason || input.diagnosticCode || 'Hard bounce reported by provider',
      );
    }

    if (input.messageId) {
      const [updated] = await this.sql<any[]>`
        UPDATE messages
        SET
          status = 'bounced',
          status_detail = ${input.reason || input.diagnosticCode || 'Hard bounce'}
        WHERE org_id = ${orgId}
          AND (provider_message_id = ${input.messageId} OR id::text = ${input.messageId})
        RETURNING record_id
      `;

      if (updated && updated.record_id) {
        const [rec] = await this.sql<any[]>`
          SELECT module_id FROM records WHERE id = ${updated.record_id}
        `;
        if (rec) {
          await this.sql`
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
              ${orgId},
              ${updated.record_id},
              ${rec.module_id},
              'email.bounced',
              NULL,
              'system',
              ${JSON.stringify({ status: 'bounced' })}::text::jsonb,
              ${JSON.stringify({
                email: cleanEmail,
                reason: input.reason || 'Hard bounce',
              })}::text::jsonb
            )
          `;
        }
      }
    }

    return {
      success: true,
      email: cleanEmail,
      suppressed: input.bounceType === 'hard' || input.bounceType === 'complaint',
    };
  }

  async getRecordMessages(orgId: string, recordId: string): Promise<MessageItem[]> {
    const rows = await this.sql<MessageItem[]>`
      SELECT
        id,
        org_id as "orgId",
        record_id as "recordId",
        thread_id as "threadId",
        channel,
        direction,
        connector_id as "connectorId",
        from_address as "fromAddress",
        to_address as "toAddress",
        subject,
        body_text as "bodyText",
        body_html as "bodyHtml",
        attachments,
        template_id as "templateId",
        provider_message_id as "providerMessageId",
        in_reply_to as "inReplyTo",
        status,
        status_detail as "statusDetail",
        sent_by as "sentBy",
        automation_run_id as "automationRunId",
        created_at as "createdAt"
      FROM messages
      WHERE org_id = ${orgId}
        AND record_id = ${recordId}
      ORDER BY created_at ASC
    `;
    return rows;
  }

  async getThreadMessages(orgId: string, threadId: string): Promise<MessageItem[]> {
    const rows = await this.sql<MessageItem[]>`
      SELECT
        id,
        org_id as "orgId",
        record_id as "recordId",
        thread_id as "threadId",
        channel,
        direction,
        connector_id as "connectorId",
        from_address as "fromAddress",
        to_address as "toAddress",
        subject,
        body_text as "bodyText",
        body_html as "bodyHtml",
        attachments,
        template_id as "templateId",
        provider_message_id as "providerMessageId",
        in_reply_to as "inReplyTo",
        status,
        status_detail as "statusDetail",
        sent_by as "sentBy",
        automation_run_id as "automationRunId",
        created_at as "createdAt"
      FROM messages
      WHERE org_id = ${orgId}
        AND thread_id = ${threadId}
      ORDER BY created_at ASC
    `;
    return rows;
  }
}
