import { z } from 'zod';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ActionHandler, ActionContext, ActionResult } from '../automations.types';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const normalised = ip.toLowerCase();
    if (normalised === '::1' || normalised === '::') return true;
    if (/^f[cd]/.test(normalised)) return true;
    if (normalised.startsWith('fe80')) return true;
    const mapped = normalised.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }

  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;         // this host, private, loopback
  if (a === 169 && b === 254) return true;                   // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;          // private
  if (a === 192 && b === 168) return true;                   // private
  if (a === 100 && b >= 64 && b <= 127) return true;         // carrier-grade NAT
  if (a >= 224) return true;                                 // multicast / reserved
  return false;
}

async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Webhook URL is not a valid URL: ${rawUrl}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Webhook URL must be http or https, got ${url.protocol}`);
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new Error(`Webhook URL host is not allowed: ${url.hostname}`);
  }

  if (isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new Error(`Webhook URL resolves to a private address: ${host}`);
    }
    return url;
  }

  if (process.env.WEBHOOK_ALLOW_PRIVATE === 'true') {
    return url;
  }

  const resolved = await dnsLookup(host, { all: true });
  if (resolved.length === 0) {
    throw new Error(`Webhook URL host does not resolve: ${url.hostname}`);
  }
  for (const entry of resolved) {
    if (isPrivateAddress(entry.address)) {
      throw new Error(`Webhook URL resolves to a private address: ${entry.address}`);
    }
  }

  return url;
}

export const webhookConfigSchema = z.object({
  url: z.string().url().max(2000),
  method: z.enum(['POST', 'PUT', 'PATCH']).default('POST'),
  headers: z.record(z.string()).optional(),
  timeoutMs: z.number().int().min(100).max(15_000).default(4000),
});

export type WebhookConfig = z.infer<typeof webhookConfigSchema>;

export class WebhookActionHandler implements ActionHandler<WebhookConfig> {
  key = 'webhook';
  label = 'Webhook';
  configSchema = webhookConfigSchema;

  async execute(ctx: ActionContext, config: WebhookConfig): Promise<ActionResult> {
    const startTime = Date.now();
    const resolvedUrl = ctx.resolve(config.url);
    await assertPublicUrl(resolvedUrl);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (config.headers) {
      for (const [k, v] of Object.entries(config.headers)) {
        headers[k] = ctx.resolve(v);
      }
    }

    const payload = {
      event: {
        id: ctx.event.id,
        type: ctx.event.type,
        aggregateId: ctx.event.aggregateId,
        recordId: ctx.event.recordId,
        moduleKey: ctx.event.moduleKey,
        occurredAt: ctx.event.occurredAt,
        actor: ctx.event.actor,
        changes: ctx.event.changes,
        causationChain: ctx.event.causationChain,
      },
      record: ctx.record,
      data: ctx.record?.data || ctx.event.snapshot?.data || {},
      displayName: ctx.record?.displayName || ctx.event.snapshot?.display_name || '',
    };

    const timeoutMs = config.timeoutMs || 4000;

    try {
      const response = await fetch(resolvedUrl, {
        method: config.method || 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const durationMs = Date.now() - startTime;
      const responseText = await response.text();

      let responseBody: unknown = responseText;
      try {
        responseBody = JSON.parse(responseText);
      } catch {
        responseBody = responseText;
      }

      if (!response.ok) {
        throw new Error(
          `Webhook failed with status ${response.status}: ${typeof responseBody === 'string' ? responseBody.slice(0, 200) : JSON.stringify(responseBody).slice(0, 200)}`
        );
      }

      return {
        success: true,
        statusCode: response.status,
        responseBody,
        durationMs,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      throw new Error(`Webhook error: ${err.message || String(err)} (${durationMs}ms)`);
    }
  }
}
