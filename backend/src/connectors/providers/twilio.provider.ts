import { z } from 'zod';
import { ProviderManifest } from '../provider.interface';

const configSchema = z.object({
  fromNumber: z.string().min(1),
  apiUrl: z.string().url().optional(),
});

const credentialSchema = z.object({
  accountSid: z.string().min(1),
  authToken: z.string().min(1),
});

export type TwilioConfig = z.infer<typeof configSchema>;
export type TwilioCreds = z.infer<typeof credentialSchema>;

export interface TwilioSendOptions {
  to: string;
  message: string;
}

export class TwilioProvider implements ProviderManifest<TwilioConfig, TwilioCreds> {
  key = 'twilio';
  label = 'Twilio SMS';
  category = 'messaging' as const;
  icon = 'Phone';
  auth = {
    type: 'basic' as const,
  };
  configSchema = configSchema;
  credentialSchema = credentialSchema;
  capabilities = ['send_sms'];
  rateLimit = {
    perSecond: 30,
    perDay: 50000,
  };

  async healthCheck(ctx: { config: TwilioConfig; credentials: TwilioCreds }): Promise<{ ok: boolean; detail?: string }> {
    if (!ctx.credentials.accountSid || !ctx.credentials.authToken) {
      return { ok: false, detail: 'accountSid and authToken are required' };
    }
    return { ok: true, detail: 'Twilio configuration validated' };
  }

  async sendSms(
    config: TwilioConfig,
    credentials: TwilioCreds,
    options: TwilioSendOptions,
  ): Promise<{ messageId: string; rawResponse: any }> {
    const baseUrl = (config.apiUrl || `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/Messages.json`).replace(/\/+$/, '');
    const cleanTo = options.to.startsWith('+') ? options.to : `+${options.to.replace(/[^\d]/g, '')}`;

    const params = new URLSearchParams();
    params.append('To', cleanTo);
    params.append('From', config.fromNumber);
    params.append('Body', options.message);

    const basicAuth = Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString('base64');

    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errorMsg = body.message || `Twilio SMS API error HTTP ${res.status}`;
      throw new Error(errorMsg);
    }

    const messageId = body.sid || `tw_${Date.now()}`;
    return {
      messageId,
      rawResponse: body,
    };
  }
}

export const twilioProvider = new TwilioProvider();
