import { z } from 'zod';
import { ActionHandler, ActionContext, ActionResult } from '../automations.types';

const configSchema = z.object({
  ownerId: z.string().optional(),
  strategy: z.enum(['fixed', 'round_robin']).default('fixed'),
  pool: z.array(z.string()).optional(),
});

type Config = z.infer<typeof configSchema>;

export const assignOwnerAction: ActionHandler<Config> = {
  key: 'assign_owner',
  label: 'Assign Owner',
  configSchema,
  async execute(ctx: ActionContext, config: Config): Promise<ActionResult> {
    const start = Date.now();
    const recordId = ctx.record?.id || ctx.event.recordId;
    if (!recordId) {
      return {
        success: false,
        error: 'Record ID is missing for assign_owner',
        durationMs: Date.now() - start,
      };
    }

    if (!ctx.sql) {
      return {
        success: false,
        error: 'Database connection not provided in context',
        durationMs: Date.now() - start,
      };
    }

    let targetOwnerId: string | null = null;

    if (config.strategy === 'round_robin' && config.pool && config.pool.length > 0) {
      if (ctx.redis) {
        try {
          const poolKey = `crm:pool:${ctx.orgId}:round_robin`;
          const count = await ctx.redis.incr(poolKey);
          const index = (count - 1) % config.pool.length;
          targetOwnerId = config.pool[index];
        } catch {
          targetOwnerId = config.pool[0];
        }
      } else {
        targetOwnerId = config.pool[0];
      }
    } else if (config.ownerId) {
      targetOwnerId = config.ownerId;
    }

    if (!targetOwnerId) {
      return {
        success: false,
        error: 'No valid owner ID determined from configuration',
        durationMs: Date.now() - start,
      };
    }

    const oldOwnerId = ctx.record?.ownerId || null;

    try {
      await ctx.sql`
        UPDATE records
        SET owner_id = ${targetOwnerId}, updated_at = now()
        WHERE id = ${recordId} AND org_id = ${ctx.orgId}
      `;

      await ctx.sql`
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
          ${(ctx.event as any).moduleId || null},
          'owner_changed',
          ${ctx.event.actor?.id || null},
          'automation',
          ${JSON.stringify({ owner_id: { from: oldOwnerId, to: targetOwnerId } })}::text::jsonb,
          ${JSON.stringify({ automation: true, assignedOwnerId: targetOwnerId })}::text::jsonb
        )
      `.catch(() => {});

      if (ctx.record) {
        ctx.record.ownerId = targetOwnerId;
      }

      return {
        success: true,
        durationMs: Date.now() - start,
        responseBody: { assignedOwnerId: targetOwnerId },
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || String(err),
        durationMs: Date.now() - start,
      };
    }
  },
};
