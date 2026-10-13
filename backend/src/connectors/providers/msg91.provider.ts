import { z } from 'zod';
import { ProviderManifest } from '../provider.interface';

const configSchema = z.object({
  senderId: z.string().min(6).max(6),
  route: z.string().default('4'),
  apiUrl: z.string().url().optional(),
});

const credentialSchema = z.object({
  authKey: z.string().min(1),
});

export type Msg91Config = z.infer<typeof configSchema>;
export type Msg91Creds = z.infer<typeof credentialSchema>;

export interface Msg91SendOptions {
  to: string;
  message: string;
  dltTemplateId?: string;
  dltHeader?: string;
}

export class Msg91Provider implements ProviderManifest<Msg91Config, Msg91Creds> {
  key = 'msg91';
  label = 'MSG91 SMS (DLT Compliant)';
  category = 'messaging' as const;
  icon = 'MessageSquare';
  auth = {
    type: 'api_key' as const,
  };
  configSchema = configSchema;
  credentialSchema = credentialSchema;
  capabilities = ['send_sms'];
  rateLimit = {
    perSecond: 50,
    perDay: 100000,
  };

  async healthCheck(ctx: { config: Msg91Config; credentials: Msg91Creds }): Promise<{ ok: boolean; detail?: string }> {
    if (!ctx.credentials.authKey) {
      return { ok: false, detail: 'AuthKey is required' };
    }
    if (!ctx.config.senderId || ctx.config.senderId.length !== 6) {
      return { ok: false, detail: 'SenderId must be a 6-character registered DLT header' };
    }
    return { ok: true, detail: 'MSG91 configuration validated' };
  }

  async sendSms(
    config: Msg91Config,
    credentials: Msg91Creds,
    options: Msg91SendOptions,
  ): Promise<{ messageId: string; rawResponse: any }> {
    const baseUrl = (config.apiUrl || 'https://control.msg91.com/api/v5/flow/').replace(/\/+$/, '');
    const cleanTo = options.to.replace(/[^\d]/g, '');

    const payload = {
      template_id: options.dltTemplateId || '',
      sender: options.dltHeader || config.senderId,
      short_url: '0',
      recipients: [
        {
          mobiles: cleanTo,
          message: options.message,
        },
      ],
    };

    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        authkey: credentials.authKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errorMsg = body.message || `MSG91 SMS API error HTTP ${res.status}`;
      throw new Error(errorMsg);
    }

    const messageId = body.request_id || body.message_id || `msg91_${Date.now()}`;
    return {
      messageId,
      rawResponse: body,
    };
  }
}

export const msg91Provider = new Msg91Provider();
