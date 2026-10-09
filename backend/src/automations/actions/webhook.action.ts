import { z } from 'zod';
import { ActionHandler, ActionContext, ActionResult } from '../automations.types';

export const webhookConfigSchema = z.object({
  url: z.string().url(),
  method: z.enum(['POST', 'PUT', 'PATCH']).default('POST'),
  headers: z.record(z.string()).optional(),
  timeoutMs: z.number().default(4000),
});

export type WebhookConfig = z.infer<typeof webhookConfigSchema>;

export class WebhookActionHandler implements ActionHandler<WebhookConfig> {
  key = 'webhook';
  label = 'Webhook';
  configSchema = webhookConfigSchema;

  async execute(ctx: ActionContext, config: WebhookConfig): Promise<ActionResult> {
    const startTime = Date.now();
    const resolvedUrl = ctx.resolve(config.url);
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
