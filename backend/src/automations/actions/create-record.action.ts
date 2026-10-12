import { z } from 'zod';
import { ActionHandler, ActionContext, ActionResult } from '../automations.types';

const configSchema = z.object({
  targetModuleKey: z.string().min(1),
  displayNameTemplate: z.string().optional(),
  fieldMapping: z.record(z.unknown()).default({}),
});

type Config = z.infer<typeof configSchema>;

export const createRecordAction: ActionHandler<Config> = {
  key: 'create_record',
  label: 'Create Record',
  configSchema,
  async execute(ctx: ActionContext, config: Config): Promise<ActionResult> {
    const start = Date.now();
    if (!ctx.sql) {
      return {
        success: false,
        error: 'Database connection not provided in context',
        durationMs: Date.now() - start,
      };
    }

    try {
      const [targetMod] = await ctx.sql<any[]>`
        SELECT id, key, label_singular, name_field_label
        FROM modules
        WHERE key = ${config.targetModuleKey} AND org_id = ${ctx.orgId} AND deleted_at IS NULL
      `;

      if (!targetMod) {
        return {
          success: false,
          error: `Target module "${config.targetModuleKey}" not found`,
          durationMs: Date.now() - start,
        };
      }

      let displayName = 'New Record';
      if (config.displayNameTemplate) {
        displayName = ctx.resolve(config.displayNameTemplate);
      } else if (ctx.record?.displayName) {
        displayName = `${ctx.record.displayName} - ${targetMod.label_singular}`;
      }

      const mappedData: Record<string, unknown> = {};
      if (config.fieldMapping && typeof config.fieldMapping === 'object') {
        for (const [key, val] of Object.entries(config.fieldMapping)) {
          if (typeof val === 'string' && val.includes('{{')) {
            mappedData[key] = ctx.resolve(val);
          } else {
            mappedData[key] = val;
          }
        }
      }

      const searchTsv = displayName;

      const [insertedRecord] = await ctx.sql<any[]>`
        INSERT INTO records (
          org_id,
          module_id,
          display_name,
          owner_id,
          pipeline_id,
          stage_id,
          stage_since,
          data,
          search_tsv,
          created_by,
          updated_by
        ) VALUES (
          ${ctx.orgId},
          ${targetMod.id},
          ${displayName},
          ${ctx.record?.ownerId || null},
          null,
          null,
          null,
          ${JSON.stringify(mappedData)}::text::jsonb,
          ${searchTsv},
          ${ctx.event.actor?.id || null},
          ${ctx.event.actor?.id || null}
        )
        RETURNING id, display_name
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
          ${insertedRecord.id},
          ${targetMod.id},
          'created',
          ${ctx.event.actor?.id || null},
          'automation',
          ${JSON.stringify({})}::text::jsonb,
          ${JSON.stringify({ automation: true, sourceRecordId: ctx.record?.id })}::text::jsonb
        )
      `.catch(() => {});

      return {
        success: true,
        durationMs: Date.now() - start,
        responseBody: {
          createdRecordId: insertedRecord.id,
          displayName: insertedRecord.display_name,
          moduleKey: config.targetModuleKey,
        },
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
