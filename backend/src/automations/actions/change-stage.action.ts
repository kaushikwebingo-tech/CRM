import { z } from 'zod';
import { ActionHandler, ActionContext, ActionResult } from '../automations.types';

const configSchema = z.object({
  stageId: z.string().min(1),
});

type Config = z.infer<typeof configSchema>;

export const changeStageAction: ActionHandler<Config> = {
  key: 'change_stage',
  label: 'Change Stage',
  configSchema,
  async execute(ctx: ActionContext, config: Config): Promise<ActionResult> {
    const start = Date.now();
    const recordId = ctx.record?.id || ctx.event.recordId;
    if (!recordId) {
      return {
        success: false,
        error: 'Record ID is missing for change_stage',
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

    const newStageId = config.stageId;
    const oldStageId = ctx.record?.stageId || null;

    try {
      const [stageRow] = await ctx.sql<any[]>`
        SELECT id, key, label, pipeline_id
        FROM pipeline_stages
        WHERE id = ${newStageId} AND org_id = ${ctx.orgId}
      `;

      if (!stageRow) {
        return {
          success: false,
          error: `Target pipeline stage ${newStageId} not found`,
          durationMs: Date.now() - start,
        };
      }

      await ctx.sql`
        UPDATE records
        SET stage_id = ${newStageId},
            stage_since = now(),
            updated_at = now()
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
          'stage_changed',
          ${ctx.event.actor?.id || null},
          'automation',
          ${JSON.stringify({ stage_id: { from: oldStageId, to: newStageId } })}::text::jsonb,
          ${JSON.stringify({ automation: true, newStageKey: stageRow.key, newStageLabel: stageRow.label })}::text::jsonb
        )
      `.catch(() => {});

      if (ctx.record) {
        ctx.record.stageId = newStageId;
      }

      return {
        success: true,
        durationMs: Date.now() - start,
        responseBody: { newStageId, stageLabel: stageRow.label },
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
