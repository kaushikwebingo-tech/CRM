import { z } from 'zod';
import { ProviderManifest } from '../provider.interface';

const configSchema = z.object({
  phoneNumberId: z.string().min(1),
  wabaId: z.string().min(1),
  verifyToken: z.string().min(1),
  apiUrl: z.string().url().optional(),
});

const credentialSchema = z.object({
  accessToken: z.string().min(1),
});

export type WhatsAppCloudConfig = z.infer<typeof configSchema>;
export type WhatsAppCloudCreds = z.infer<typeof credentialSchema>;

export interface WhatsAppSendOptions {
  to: string;
  type?: 'template' | 'text' | 'interactive';
  text?: string;
  template?: {
    name: string;
    languageCode?: string;
    components?: any[];
  };
  contextMessageId?: string;
}

export class WhatsAppCloudProvider implements ProviderManifest<WhatsAppCloudConfig, WhatsAppCloudCreds> {
  key = 'whatsapp_cloud';
  label = 'Meta WhatsApp Cloud API';
  category = 'messaging' as const;
  icon = 'MessageSquare';
  auth = {
    type: 'api_key' as const,
  };
  configSchema = configSchema;
  credentialSchema = credentialSchema;
  capabilities = ['send_whatsapp', 'inbound_whatsapp'];
  rateLimit = {
    perSecond: 80,
    perDay: 100000,
  };

  async healthCheck(ctx: { config: WhatsAppCloudConfig; credentials: WhatsAppCloudCreds }): Promise<{ ok: boolean; detail?: string }> {
    try {
      const baseUrl = (ctx.config.apiUrl || 'https://graph.facebook.com/v19.0').replace(/\/+$/, '');
      const url = `${baseUrl}/${ctx.config.phoneNumberId}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${ctx.credentials.accessToken}`,
        },
      });

      if (res.ok) {
        return { ok: true, detail: 'WhatsApp Phone Number connection verified' };
      }
      return { ok: false, detail: `Meta API returned HTTP ${res.status}` };
    } catch (err: any) {
      return { ok: false, detail: err.message || 'Failed to connect to Meta WhatsApp Cloud API' };
    }
  }

  async sendMessage(
    config: WhatsAppCloudConfig,
    credentials: WhatsAppCloudCreds,
    options: WhatsAppSendOptions,
  ): Promise<{ messageId: string; rawResponse: any }> {
    const baseUrl = (config.apiUrl || 'https://graph.facebook.com/v19.0').replace(/\/+$/, '');
    const url = `${baseUrl}/${config.phoneNumberId}/messages`;

    let payload: Record<string, any>;

    const cleanTo = options.to.replace(/[^\d]/g, '');

    if (options.template) {
      payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanTo,
        type: 'template',
        template: {
          name: options.template.name,
          language: {
            code: options.template.languageCode || 'en',
          },
          components: options.template.components || [],
        },
      };
    } else {
      payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanTo,
        type: 'text',
        text: {
          preview_url: false,
          body: options.text || '',
        },
      };
      if (options.contextMessageId) {
        payload.context = {
          message_id: options.contextMessageId,
        };
      }
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errorMsg = body.error?.message || body.message || `Meta WhatsApp API error HTTP ${res.status}`;
      throw new Error(errorMsg);
    }

    const messageId = body.messages?.[0]?.id || body.id || `wamid.${Date.now()}`;
    return {
      messageId,
      rawResponse: body,
    };
  }

  inboundVerify(req: any): boolean {
    if (!req) return false;
    const mode = req.query?.['hub.mode'];
    const token = req.query?.['hub.verify_token'];
    return mode === 'subscribe' && typeof token === 'string' && token.length > 0;
  }

  inboundParse(body: any): any[] {
    if (!body || typeof body !== 'object') return [];

    if (body.from && (body.text || body.body)) {
      return [
        {
          from: body.from,
          to: body.to,
          body: body.text || body.body,
          messageId: body.messageId || body.id || `wamid.${Date.now()}`,
          contextMessageId: body.contextMessageId || body.inReplyTo,
          channel: 'whatsapp',
        },
      ];
    }

    const parsed: any[] = [];
    const entries = body.entry || [];

    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const val = change.value;
        if (!val) continue;

        if (Array.isArray(val.messages)) {
          for (const msg of val.messages) {
            let textBody = '';
            if (msg.type === 'text') {
              textBody = msg.text?.body || '';
            } else if (msg.type === 'button') {
              textBody = msg.button?.text || msg.button?.payload || '';
            } else if (msg.type === 'interactive') {
              textBody =
                msg.interactive?.button_reply?.title ||
                msg.interactive?.button_reply?.id ||
                msg.interactive?.list_reply?.title ||
                '';
            }

            parsed.push({
              from: msg.from,
              to: val.metadata?.display_phone_number,
              body: textBody,
              messageId: msg.id,
              timestamp: msg.timestamp,
              contextMessageId: msg.context?.id,
              channel: 'whatsapp',
              type: 'message',
            });
          }
        }

        if (Array.isArray(val.statuses)) {
          for (const status of val.statuses) {
            parsed.push({
              messageId: status.id,
              status: status.status,
              timestamp: status.timestamp,
              recipientId: status.recipient_id,
              channel: 'whatsapp',
              type: 'status',
            });
          }
        }
      }
    }

    return parsed;
  }
}

export const whatsappCloudProvider = new WhatsAppCloudProvider();
