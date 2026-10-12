import { z } from 'zod';
import { ProviderManifest } from '../provider.interface';

const configSchema = z.object({
  baseUrl: z.string().url(),
  defaultHeaders: z.record(z.string()).optional(),
  timeoutMs: z.number().int().min(100).max(15000).default(5000),
});

const credentialSchema = z.object({
  apiKey: z.string().optional(),
  secret: z.string().optional(),
});

export type WebhookOutConfig = z.infer<typeof configSchema>;
export type WebhookOutCreds = z.infer<typeof credentialSchema>;

export class WebhookOutProvider implements ProviderManifest<WebhookOutConfig, WebhookOutCreds> {
  key = 'webhook_out';
  label = 'Generic Outbound Webhook';
  category = 'generic' as const;
  icon = 'Globe';
  auth = {
    type: 'api_key' as const,
  };
  configSchema = configSchema;
  credentialSchema = credentialSchema;
  capabilities = ['webhook_out'];
  rateLimit = {
    perSecond: 20,
    perDay: 100000,
  };

  async healthCheck(ctx: { config: WebhookOutConfig; credentials: WebhookOutCreds }): Promise<{ ok: boolean; detail?: string }> {
    try {
      const url = new URL(ctx.config.baseUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { ok: false, detail: 'URL must be http or https' };
      }
      return { ok: true, detail: 'Webhook endpoint URL validated' };
    } catch (err: any) {
      return { ok: false, detail: err.message || 'Invalid webhook configuration' };
    }
  }
}

export const webhookOutProvider = new WebhookOutProvider();
