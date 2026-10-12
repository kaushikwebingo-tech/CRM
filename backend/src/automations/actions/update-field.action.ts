import { z } from 'zod';
import { ActionHandler, ActionContext, ActionResult } from '../automations.types';

const configSchema = z.object({
  fieldKey: z.string().min(1),
  value: z.unknown(),
});

type Config = z.infer<typeof configSchema>;

export const updateFieldAction: ActionHandler<Config> = {
  key: 'update_field',
  label: 'Update Field',
  configSchema,
  async execute(ctx: ActionContext, config: Config): Promise<ActionResult> {
    const start = Date.now();
    const recordId = ctx.record?.id || ctx.event.recordId;
    if (!recordId) {
      return {
        success: false,
        error: 'Record ID is missing for update_field',
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

    let resolvedValue = config.value;
    if (typeof config.value === 'string' && config.value.includes('{{')) {
      resolvedValue = ctx.resolve(config.value);
    }

    const fieldKey = config.fieldKey;
    const oldVal = (ctx.record?.data as any)?.[fieldKey] ?? (ctx.record as any)?.[fieldKey];

    try {
      if (fieldKey === 'display_name') {
        await ctx.sql`
          UPDATE records
          SET display_name = ${String(resolvedValue)}, updated_at = now()
          WHERE id = ${recordId} AND org_id = ${ctx.orgId}
        `;
      } else if (fieldKey === 'owner_id') {
        await ctx.sql`
          UPDATE records
          SET owner_id = ${resolvedValue as string}, updated_at = now()
          WHERE id = ${recordId} AND org_id = ${ctx.orgId}
        `;
      } else {
        const patchData = { [fieldKey]: resolvedValue };
        await ctx.sql`
          UPDATE records
          SET data = data || ${JSON.stringify(patchData)}::text::jsonb, updated_at = now()
          WHERE id = ${recordId} AND org_id = ${ctx.orgId}
        `;
      }

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
          'updated',
          ${ctx.event.actor?.id || null},
          'automation',
          ${JSON.stringify({ [fieldKey]: { from: oldVal, to: resolvedValue } })}::text::jsonb,
          ${JSON.stringify({ automation: true, fieldKey, value: resolvedValue })}::text::jsonb
        )
      `.catch(() => {});

      if (ctx.record) {
        if (fieldKey === 'display_name') {
          ctx.record.displayName = String(resolvedValue);
        } else if (fieldKey === 'owner_id') {
          ctx.record.ownerId = String(resolvedValue);
        } else {
          ctx.record.data[fieldKey] = resolvedValue;
        }
      }

      return {
        success: true,
        durationMs: Date.now() - start,
        responseBody: { fieldKey, value: resolvedValue },
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
