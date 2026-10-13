import { Injectable, Inject } from '@nestjs/common';
import postgres from 'postgres';
import * as crypto from 'crypto';
import { PG_CLIENT } from '../db/connection';
import { CredentialVault } from '../connectors/credential-vault';
import { SuppressionService } from '../email/suppression.service';
import { ConsentService } from '../consents/consent.service';
import { TemplateEngine, TemplateContext } from '../templates/template-engine';
import { getProvider } from '../connectors/provider-registry';
import { WhatsAppCloudProvider } from '../connectors/providers/whatsapp-cloud.provider';
import { Msg91Provider } from '../connectors/providers/msg91.provider';
import { TwilioProvider } from '../connectors/providers/twilio.provider';
import {
  OutboundWhatsAppDto,
  OutboundSmsDto,
  WhatsAppSessionWindow,
} from './messaging.types';
import { NotFoundError, ValidationError } from '../common/errors';

@Injectable()
export class MessagingService {
  private readonly whatsappCloud = new WhatsAppCloudProvider();
  private readonly msg91 = new Msg91Provider();
  private readonly twilio = new TwilioProvider();

  constructor(
    @Inject(PG_CLIENT) private readonly sql: postgres.Sql,
    private readonly credentialVault: CredentialVault,
    private readonly suppressionService: SuppressionService,
    private readonly consentService: ConsentService,
  ) {}

  private jsonb(value: unknown): string {
    return JSON.stringify(value ?? {});
  }

  private cleanPhone(raw: string): string {
    return raw.replace(/[^\d\+]/g, '');
  }

  async getSessionWindow(orgId: string, recordId: string): Promise<WhatsAppSessionWindow> {
    const [row] = await this.sql<any[]>`
      SELECT MAX(created_at) AS last_inbound
      FROM messages
      WHERE org_id = ${orgId}
        AND record_id = ${recordId}
        AND channel = 'whatsapp'
        AND direction = 'inbound'
    `;

    if (!row || !row.last_inbound) {
      return {
        isOpen: false,
        lastInboundAt: null,
        expiresAt: null,
        remainingMinutes: 0,
      };
    }

    const lastInboundDate = new Date(row.last_inbound);
    const windowMs = 24 * 60 * 60 * 1000;
    const diffMs = Date.now() - lastInboundDate.getTime();
    const isOpen = diffMs < windowMs;
    const remainingMinutes = isOpen ? Math.max(0, Math.floor((windowMs - diffMs) / 60000)) : 0;
    const expiresAt = new Date(lastInboundDate.getTime() + windowMs).toISOString();

    return {
      isOpen,
      lastInboundAt: lastInboundDate.toISOString(),
      expiresAt,
      remainingMinutes,
    };
  }

  async sendWhatsApp(orgId: string, dto: OutboundWhatsAppDto, actorId?: string): Promise<any> {
    if (!dto.recordId) {
      throw new ValidationError('recordId is required', [{ field: 'recordId', message: 'recordId is required' }]);
    }

    const [record] = await this.sql<any[]>`
      SELECT id, module_id, display_name, data, owner_id
      FROM records
      WHERE id = ${dto.recordId}
        AND org_id = ${orgId}
        AND deleted_at IS NULL
    `;

    if (!record) {
      throw new NotFoundError(`Record ${dto.recordId} not found`);
    }

    let toPhone = dto.toPhone;
    if (!toPhone) {
      const phoneField = record.data?.phone || record.data?.mobile || record.data?.whatsapp;
      if (typeof phoneField === 'string' && phoneField.trim()) {
        toPhone = phoneField.trim();
      }
    }

    if (!toPhone) {
      throw new ValidationError('Recipient phone number not found on record', [
        { field: 'toPhone', message: 'Recipient phone number not found on record' },
      ]);
    }

    const cleanTo = this.cleanPhone(toPhone);

    const isSuppressed = await this.suppressionService.isSuppressed(orgId, cleanTo, 'whatsapp');
    if (isSuppressed) {
      throw new ValidationError(`Recipient phone number ${cleanTo} is suppressed due to previous opt-out or bounce`, [
        { field: 'toPhone', message: `Recipient phone number ${cleanTo} is suppressed` },
      ]);
    }

    const purpose = dto.purpose || 'utility';
    const consentCheck = await this.consentService.checkConsent(orgId, dto.recordId, 'whatsapp', purpose);
    if (!consentCheck.allowed) {
      throw new ValidationError(consentCheck.reason || 'Consent verification failed', [
        { field: 'consent', message: consentCheck.reason || 'Consent verification failed' },
      ]);
    }

    const sessionWindow = await this.getSessionWindow(orgId, dto.recordId);
    if (!sessionWindow.isOpen && !dto.templateId) {
      throw new ValidationError(
        'Free-form WhatsApp messages cannot be sent outside the 24-hour customer session window. An approved template is required.',
        [{ field: 'templateId', message: 'Approved template required outside 24-hour session window' }],
      );
    }

    let connectorRow: any;
    if (dto.connectorId) {
      const [c] = await this.sql<any[]>`
        SELECT *
        FROM connectors
        WHERE id = ${dto.connectorId}
          AND org_id = ${orgId}
          AND is_active = true
      `;
      connectorRow = c;
    } else {
      const [c] = await this.sql<any[]>`
        SELECT *
        FROM connectors
        WHERE org_id = ${orgId}
          AND provider_key = 'whatsapp_cloud'
          AND is_active = true
        ORDER BY created_at ASC
        LIMIT 1
      `;
      connectorRow = c;
    }

    if (!connectorRow) {
      throw new ValidationError('No active Meta WhatsApp Cloud connector found', [
        { field: 'connectorId', message: 'Active WhatsApp Cloud connector required' },
      ]);
    }

    const creds = this.credentialVault.decrypt<any>(connectorRow.credentials);
    const config = connectorRow.config || {};

    let sendText = dto.text || '';
    let templateName: string | undefined;

    if (dto.templateId) {
      const [tpl] = await this.sql<any[]>`
        SELECT *
        FROM templates
        WHERE id = ${dto.templateId}
          AND org_id = ${orgId}
          AND deleted_at IS NULL
      `;
      if (!tpl) {
        throw new NotFoundError(`Template ${dto.templateId} not found`);
      }

      templateName = tpl.name;

      let ownerRow: any = null;
      if (record.owner_id) {
        const [u] = await this.sql<any[]>`SELECT id, full_name, email FROM users WHERE id = ${record.owner_id}`;
        ownerRow = u;
      }

      const [orgRow] = await this.sql<any[]>`SELECT id, name FROM organizations WHERE id = ${orgId}`;

      const tplContext: TemplateContext = {
        record: {
          id: record.id,
          displayName: record.display_name,
          data: record.data || {},
        },
        owner: ownerRow ? { id: ownerRow.id, fullName: ownerRow.full_name, email: ownerRow.email } : undefined,
        org: orgRow ? { name: orgRow.name } : undefined,
        link: {
          record: `http://localhost:5173/records/${record.id}`,
          unsubscribe: `http://localhost:5173/unsubscribe?token=${record.id}`,
        },
      };

      sendText = TemplateEngine.render(tpl.body, tplContext);
    }

    const sendRes = await this.whatsappCloud.sendMessage(config, creds, {
      to: cleanTo,
      text: sendText,
      template: templateName
        ? {
            name: templateName,
          }
        : undefined,
    });

    const [existingThread] = await this.sql<any[]>`
      SELECT thread_id
      FROM messages
      WHERE org_id = ${orgId}
        AND record_id = ${dto.recordId}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const threadId = existingThread?.thread_id || crypto.randomUUID();

    const [inserted] = await this.sql<any[]>`
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
        sent_by,
        metadata
      ) VALUES (
        ${orgId},
        ${dto.recordId},
        ${threadId},
        'whatsapp',
        'outbound',
        ${connectorRow.id},
        ${config.phoneNumberId || 'whatsapp_business'},
        ${cleanTo},
        ${sendText},
        ${dto.templateId || null},
        ${sendRes.messageId},
        'sent',
        ${actorId || null},
        ${this.jsonb({ rawResponse: sendRes.rawResponse, sessionWindowOpen: sessionWindow.isOpen })}::text::jsonb
      )
      RETURNING *
    `;

    await this.sql`
      INSERT INTO record_events (
        org_id,
        record_id,
        module_id,
        type,
        actor_id,
        actor_type,
        payload
      ) VALUES (
        ${orgId},
        ${dto.recordId},
        ${record.module_id},
        'message.sent',
        ${actorId || null},
        ${actorId ? 'user' : 'system'},
        ${this.jsonb({
          channel: 'whatsapp',
          messageId: inserted.id,
          providerMessageId: sendRes.messageId,
          to: cleanTo,
          threadId,
          templateId: dto.templateId,
        })}::text::jsonb
      )
    `;

    return inserted;
  }

  async sendSms(orgId: string, dto: OutboundSmsDto, actorId?: string): Promise<any> {
    if (!dto.recordId) {
      throw new ValidationError('recordId is required', [{ field: 'recordId', message: 'recordId is required' }]);
    }

    const [record] = await this.sql<any[]>`
      SELECT id, module_id, display_name, data, owner_id
      FROM records
      WHERE id = ${dto.recordId}
        AND org_id = ${orgId}
        AND deleted_at IS NULL
    `;

    if (!record) {
      throw new NotFoundError(`Record ${dto.recordId} not found`);
    }

    let toPhone = dto.toPhone;
    if (!toPhone) {
      const phoneField = record.data?.phone || record.data?.mobile;
      if (typeof phoneField === 'string' && phoneField.trim()) {
        toPhone = phoneField.trim();
      }
    }

    if (!toPhone) {
      throw new ValidationError('Recipient phone number not found on record', [
        { field: 'toPhone', message: 'Recipient phone number not found on record' },
      ]);
    }

    const cleanTo = this.cleanPhone(toPhone);

    const isSuppressed = await this.suppressionService.isSuppressed(orgId, cleanTo, 'sms');
    if (isSuppressed) {
      throw new ValidationError(`Recipient phone number ${cleanTo} is suppressed due to previous opt-out`, [
        { field: 'toPhone', message: `Recipient phone number ${cleanTo} is suppressed` },
      ]);
    }

    const purpose = dto.purpose || 'utility';
    const consentCheck = await this.consentService.checkConsent(orgId, dto.recordId, 'sms', purpose);
    if (!consentCheck.allowed) {
      throw new ValidationError(consentCheck.reason || 'Consent verification failed', [
        { field: 'consent', message: consentCheck.reason || 'Consent verification failed' },
      ]);
    }

    let connectorRow: any;
    if (dto.connectorId) {
      const [c] = await this.sql<any[]>`
        SELECT *
        FROM connectors
        WHERE id = ${dto.connectorId}
          AND org_id = ${orgId}
          AND is_active = true
      `;
      connectorRow = c;
    } else {
      const [c] = await this.sql<any[]>`
        SELECT *
        FROM connectors
        WHERE org_id = ${orgId}
          AND provider_key IN ('msg91', 'twilio')
          AND is_active = true
        ORDER BY created_at ASC
        LIMIT 1
      `;
      connectorRow = c;
    }

    if (!connectorRow) {
      throw new ValidationError('No active SMS connector (msg91 or twilio) found', [
        { field: 'connectorId', message: 'Active SMS connector required' },
      ]);
    }

    const creds = this.credentialVault.decrypt<any>(connectorRow.credentials);
    const config = connectorRow.config || {};

    let sendText = dto.text || '';
    let dltTemplateId = dto.dltTemplateId;
    let dltHeader = dto.dltHeader || config.senderId;

    if (dto.templateId) {
      const [tpl] = await this.sql<any[]>`
        SELECT *
        FROM templates
        WHERE id = ${dto.templateId}
          AND org_id = ${orgId}
          AND deleted_at IS NULL
      `;
      if (!tpl) {
        throw new NotFoundError(`Template ${dto.templateId} not found`);
      }

      dltTemplateId = dltTemplateId || tpl.dlt_template_id;
      dltHeader = dltHeader || tpl.dlt_header;

      let ownerRow: any = null;
      if (record.owner_id) {
        const [u] = await this.sql<any[]>`SELECT id, full_name, email FROM users WHERE id = ${record.owner_id}`;
        ownerRow = u;
      }

      const [orgRow] = await this.sql<any[]>`SELECT id, name FROM organizations WHERE id = ${orgId}`;

      const tplContext: TemplateContext = {
        record: {
          id: record.id,
          displayName: record.display_name,
          data: record.data || {},
        },
        owner: ownerRow ? { id: ownerRow.id, fullName: ownerRow.full_name, email: ownerRow.email } : undefined,
        org: orgRow ? { name: orgRow.name } : undefined,
        link: {
          record: `http://localhost:5173/records/${record.id}`,
          unsubscribe: `http://localhost:5173/unsubscribe?token=${record.id}`,
        },
      };

      sendText = TemplateEngine.render(tpl.body, tplContext);
    }

    let sendRes: { messageId: string; rawResponse: any };

    if (connectorRow.provider_key === 'msg91') {
      sendRes = await this.msg91.sendSms(config, creds, {
        to: cleanTo,
        message: sendText,
        dltTemplateId,
        dltHeader,
      });
    } else {
      sendRes = await this.twilio.sendSms(config, creds, {
        to: cleanTo,
        message: sendText,
      });
    }

    const [existingThread] = await this.sql<any[]>`
      SELECT thread_id
      FROM messages
      WHERE org_id = ${orgId}
        AND record_id = ${dto.recordId}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const threadId = existingThread?.thread_id || crypto.randomUUID();

    const [inserted] = await this.sql<any[]>`
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
        sent_by,
        metadata
      ) VALUES (
        ${orgId},
        ${dto.recordId},
        ${threadId},
        'sms',
        'outbound',
        ${connectorRow.id},
        ${dltHeader || config.fromNumber || 'SMS_SERVICE'},
        ${cleanTo},
        ${sendText},
        ${dto.templateId || null},
        ${sendRes.messageId},
        'sent',
        ${actorId || null},
        ${this.jsonb({ rawResponse: sendRes.rawResponse, dltTemplateId, dltHeader })}::text::jsonb
      )
      RETURNING *
    `;

    await this.sql`
      INSERT INTO record_events (
        org_id,
        record_id,
        module_id,
        type,
        actor_id,
        actor_type,
        payload
      ) VALUES (
        ${orgId},
        ${dto.recordId},
        ${record.module_id},
        'message.sent',
        ${actorId || null},
        ${actorId ? 'user' : 'system'},
        ${this.jsonb({
          channel: 'sms',
          messageId: inserted.id,
          providerMessageId: sendRes.messageId,
          to: cleanTo,
          threadId,
          templateId: dto.templateId,
        })}::text::jsonb
      )
    `;

    return inserted;
  }

  async processInbound(
    connectorId: string,
    orgId: string,
    payload: any,
    headers?: any,
    query?: any,
  ): Promise<any> {
    const [connector] = await this.sql<any[]>`
      SELECT *
      FROM connectors
      WHERE id = ${connectorId}
        AND org_id = ${orgId}
        AND is_active = true
    `;

    if (!connector) {
      throw new NotFoundError(`Connector ${connectorId} not found`);
    }

    const provider = getProvider(connector.provider_key);
    if (!provider) {
      throw new NotFoundError(`Provider ${connector.provider_key} not registered`);
    }

    if (query && query['hub.mode'] === 'subscribe') {
      if (query['hub.verify_token'] === connector.config?.verifyToken) {
        return {
          challenge: query['hub.challenge'],
        };
      }
      throw new ValidationError('Invalid webhook verification token');
    }

    const parsedEvents = provider.inboundParse ? provider.inboundParse(payload) : [];
    if (!parsedEvents || parsedEvents.length === 0) {
      return { success: true, processed: 0 };
    }

    const results: any[] = [];

    for (const event of parsedEvents) {
      if (event.type === 'status') {
        const [updated] = await this.sql<any[]>`
          UPDATE messages
          SET status = ${event.status}, status_detail = ${event.status}
          WHERE provider_message_id = ${event.messageId}
            AND connector_id = ${connectorId}
          RETURNING *
        `;
        results.push({ type: 'status', updated: !!updated });
        continue;
      }

      const providerMsgId = event.messageId || `msg_${Date.now()}`;

      const [existing] = await this.sql<any[]>`
        SELECT id, record_id, thread_id
        FROM messages
        WHERE connector_id = ${connectorId}
          AND provider_message_id = ${providerMsgId}
        LIMIT 1
      `;

      if (existing) {
        results.push({ type: 'duplicate', messageId: existing.id });
        continue;
      }

      let matchedRecordId: string | null = null;
      let matchedThreadId: string | null = null;
      let matchedModuleId: string | null = null;

      if (event.contextMessageId) {
        const [parent] = await this.sql<any[]>`
          SELECT record_id, thread_id
          FROM messages
          WHERE org_id = ${orgId}
            AND provider_message_id = ${event.contextMessageId}
          LIMIT 1
        `;
        if (parent) {
          matchedRecordId = parent.record_id;
          matchedThreadId = parent.thread_id;
        }
      }

      if (!matchedRecordId && event.from) {
        const cleanFrom = this.cleanPhone(event.from);
        const last10 = cleanFrom.slice(-10);

        const [rec] = await this.sql<any[]>`
          SELECT id, module_id
          FROM records
          WHERE org_id = ${orgId}
            AND deleted_at IS NULL
            AND (
              data->>'phone' ILIKE ${'%' + last10}
              OR data->>'mobile' ILIKE ${'%' + last10}
              OR data->>'whatsapp' ILIKE ${'%' + last10}
            )
          ORDER BY created_at DESC
          LIMIT 1
        `;

        if (rec) {
          matchedRecordId = rec.id;
          matchedModuleId = rec.module_id;
        }
      }

      if (matchedRecordId && !matchedThreadId) {
        const [existingThread] = await this.sql<any[]>`
          SELECT thread_id
          FROM messages
          WHERE org_id = ${orgId}
            AND record_id = ${matchedRecordId}
          ORDER BY created_at DESC
          LIMIT 1
        `;
        matchedThreadId = existingThread?.thread_id || crypto.randomUUID();
      }

      if (!matchedThreadId) {
        matchedThreadId = crypto.randomUUID();
      }

      const bodyText = (event.body || '').trim();
      const upper = bodyText.toUpperCase();
      if (upper === 'STOP' || upper === 'UNSUBSCRIBE' || upper === 'OPTOUT') {
        if (matchedRecordId) {
          await this.consentService.withdrawConsent(orgId, {
            recordId: matchedRecordId,
            channel: event.channel === 'sms' ? 'sms' : 'whatsapp',
            reason: 'inbound_stop_keyword',
          });
        }
      }

      const [saved] = await this.sql<any[]>`
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
          provider_message_id,
          in_reply_to,
          status,
          metadata
        ) VALUES (
          ${orgId},
          ${matchedRecordId},
          ${matchedThreadId},
          ${event.channel || 'whatsapp'},
          'inbound',
          ${connectorId},
          ${event.from || ''},
          ${event.to || ''},
          ${bodyText},
          ${providerMsgId},
          ${event.contextMessageId || null},
          'delivered',
          ${this.jsonb(event)}::text::jsonb
        )
        RETURNING *
      `;

      if (matchedRecordId) {
        if (!matchedModuleId) {
          const [r] = await this.sql<any[]>`SELECT module_id FROM records WHERE id = ${matchedRecordId}`;
          matchedModuleId = r?.module_id;
        }

        await this.sql`
          INSERT INTO record_events (
            org_id,
            record_id,
            module_id,
            type,
            actor_id,
            actor_type,
            payload
          ) VALUES (
            ${orgId},
            ${matchedRecordId},
            ${matchedModuleId},
            'message.received',
            null,
            'customer',
            ${this.jsonb({
              channel: event.channel || 'whatsapp',
              messageId: saved.id,
              threadId: matchedThreadId,
              from: event.from,
              preview: bodyText.slice(0, 100),
            })}::text::jsonb
          )
        `;
      }

      results.push({
        type: 'message',
        messageId: saved.id,
        threadId: matchedThreadId,
        recordId: matchedRecordId,
      });
    }

    return {
      success: true,
      processed: results.length,
      results,
    };
  }
}
