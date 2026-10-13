import { Injectable, Inject } from '@nestjs/common';
import postgres from 'postgres';
import { PG_CLIENT } from '../db/connection';
import { ModulesService } from '../metadata/modules.service';
import { SchemaCompiler } from '../metadata/schema-compiler';
import {
  CreateActivityDto,
  UpdateActivityDto,
  ActivityItem,
} from './activities.types';
import { NotFoundError } from '../common/errors';

@Injectable()
export class ActivitiesService {
  constructor(
    @Inject(PG_CLIENT) private readonly sql: postgres.Sql,
    private readonly modulesService: ModulesService,
    private readonly schemaCompiler: SchemaCompiler,
  ) {}

  private jsonb(value: unknown): string {
    return JSON.stringify(value ?? {});
  }

  async ensureActivityModule(orgId: string): Promise<any> {
    const [existing] = await this.sql<any[]>`
      SELECT *
      FROM modules
      WHERE org_id = ${orgId}
        AND key = 'activity'
        AND deleted_at IS NULL
      LIMIT 1
    `;

    if (existing) {
      return existing;
    }

    const [mod] = await this.sql<any[]>`
      INSERT INTO modules (
        org_id,
        key,
        label_singular,
        label_plural,
        icon,
        color,
        has_pipeline,
        name_field_label,
        is_system,
        position
      ) VALUES (
        ${orgId},
        'activity',
        'Activity',
        'Activities',
        'calendar',
        '#6366F1',
        true,
        'Subject',
        true,
        9
      )
      RETURNING *
    `;

    const [pipeline] = await this.sql<any[]>`
      INSERT INTO pipelines (
        org_id,
        module_id,
        name,
        is_default,
        position
      ) VALUES (
        ${orgId},
        ${mod.id},
        'Activity Lifecycle',
        true,
        0
      )
      RETURNING *
    `;

    await this.sql`
      INSERT INTO pipeline_stages (
        org_id,
        pipeline_id,
        key,
        label,
        color,
        type,
        probability,
        position
      ) VALUES
        (${orgId}, ${pipeline.id}, 'open', 'Open', 'blue', 'open', null, 0),
        (${orgId}, ${pipeline.id}, 'done', 'Done', 'green', 'won', 100, 1),
        (${orgId}, ${pipeline.id}, 'cancelled', 'Cancelled', 'slate', 'lost', 0, 2)
    `;

    const fieldsToSeed = [
      {
        key: 'activity_type',
        label: 'Type',
        type: 'select',
        config: {
          options: [
            { id: 'task', label: 'Task', color: 'blue' },
            { id: 'call', label: 'Call', color: 'emerald' },
            { id: 'meeting', label: 'Meeting', color: 'purple' },
            { id: 'note', label: 'Note', color: 'amber' },
          ],
        },
        isRequired: true,
      },
      {
        key: 'priority',
        label: 'Priority',
        type: 'select',
        config: {
          options: [
            { id: 'low', label: 'Low', color: 'slate' },
            { id: 'medium', label: 'Medium', color: 'blue' },
            { id: 'high', label: 'High', color: 'amber' },
            { id: 'urgent', label: 'Urgent', color: 'rose' },
          ],
        },
      },
      { key: 'due_date', label: 'Due Date', type: 'datetime' },
      {
        key: 'direction',
        label: 'Direction',
        type: 'select',
        config: {
          options: [
            { id: 'inbound', label: 'Inbound', color: 'blue' },
            { id: 'outbound', label: 'Outbound', color: 'emerald' },
          ],
        },
      },
      { key: 'outcome', label: 'Outcome', type: 'text' },
      { key: 'duration_minutes', label: 'Duration (min)', type: 'number' },
      { key: 'start_at', label: 'Start Time', type: 'datetime' },
      { key: 'end_at', label: 'End Time', type: 'datetime' },
      { key: 'location', label: 'Location / Link', type: 'text' },
      { key: 'attendees', label: 'Attendees', type: 'tags' },
      { key: 'notes', label: 'Notes', type: 'long_text' },
      { key: 'is_pinned', label: 'Pinned', type: 'boolean' },
      { key: 'related_to_module', label: 'Related Module', type: 'text' },
      { key: 'related_to_id', label: 'Related Record ID', type: 'text' },
    ];

    for (let i = 0; i < fieldsToSeed.length; i++) {
      const f = fieldsToSeed[i];
      await this.sql`
        INSERT INTO fields (
          org_id,
          module_id,
          key,
          label,
          type,
          config,
          is_required,
          is_system,
          position
        ) VALUES (
          ${orgId},
          ${mod.id},
          ${f.key},
          ${f.label},
          ${f.type},
          ${this.jsonb(f.config || {})}::text::jsonb,
          ${f.isRequired ?? false},
          ${true},
          ${i}
        )
      `;
    }

    this.schemaCompiler.invalidate(mod.id);
    return mod;
  }

  async create(
    orgId: string,
    dto: CreateActivityDto,
    creatorUserId?: string,
  ): Promise<ActivityItem> {
    const mod = await this.ensureActivityModule(orgId);

    const [pipeline] = await this.sql<any[]>`
      SELECT id
      FROM pipelines
      WHERE org_id = ${orgId}
        AND module_id = ${mod.id}
        AND deleted_at IS NULL
      LIMIT 1
    `;

    const [openStage] = await this.sql<any[]>`
      SELECT id
      FROM pipeline_stages
      WHERE pipeline_id = ${pipeline?.id}
        AND org_id = ${orgId}
        AND key = 'open'
      LIMIT 1
    `;

    const ownerId = dto.assigneeId || creatorUserId || null;

    const data: Record<string, unknown> = {
      ...(dto.data || {}),
      activity_type: dto.activityType,
      priority: dto.priority || 'medium',
      due_date: dto.dueDate || null,
      direction: dto.direction || null,
      outcome: dto.outcome || null,
      duration_minutes: dto.durationMinutes || null,
      start_at: dto.startAt || null,
      end_at: dto.endAt || null,
      location: dto.location || null,
      attendees: dto.attendees || [],
      notes: dto.body || null,
      is_pinned: dto.isPinned || false,
      related_to_module: dto.relatedToModule || null,
      related_to_id: dto.relatedToId || null,
    };

    const title = dto.title || `${dto.activityType.toUpperCase()}: ${dto.body?.slice(0, 40) || 'Activity'}`;

    const [rec] = await this.sql<any[]>`
      INSERT INTO records (
        org_id,
        module_id,
        display_name,
        owner_id,
        pipeline_id,
        stage_id,
        stage_since,
        data,
        created_by
      ) VALUES (
        ${orgId},
        ${mod.id},
        ${title},
        ${ownerId},
        ${pipeline?.id || null},
        ${openStage?.id || null},
        now(),
        ${this.jsonb(data)}::text::jsonb,
        ${creatorUserId || null}
      )
      RETURNING *
    `;

    if (dto.relatedToId) {
      await this.sql`
        INSERT INTO record_events (
          org_id,
          record_id,
          module_id,
          type,
          actor_id,
          actor_type,
          payload
        ) VALUES (
          ${orgId},
          ${dto.relatedToId},
          ${mod.id},
          'activity.logged',
          ${creatorUserId || null},
          'user',
          ${this.jsonb({
            activityId: rec.id,
            activityType: dto.activityType,
            title,
            dueDate: dto.dueDate,
          })}::text::jsonb
        )
      `;
    }

    return {
      id: rec.id,
      orgId: rec.org_id,
      activityType: dto.activityType,
      title: rec.display_name,
      relatedToModule: dto.relatedToModule || null,
      relatedToId: dto.relatedToId || null,
      stageId: rec.stage_id,
      ownerId: rec.owner_id,
      data: rec.data || {},
      createdAt: new Date(rec.created_at).toISOString(),
      updatedAt: new Date(rec.updated_at).toISOString(),
    };
  }

  async list(
    orgId: string,
    filters: {
      relatedToId?: string;
      activityType?: string;
      ownerId?: string;
      stageId?: string;
      limit?: number;
    } = {},
  ): Promise<ActivityItem[]> {
    const mod = await this.ensureActivityModule(orgId);

    const rows = await this.sql<any[]>`
      SELECT *
      FROM records
      WHERE org_id = ${orgId}
        AND module_id = ${mod.id}
        AND deleted_at IS NULL
        ${filters.relatedToId ? this.sql`AND data->>'related_to_id' = ${filters.relatedToId}` : this.sql``}
        ${filters.activityType ? this.sql`AND data->>'activity_type' = ${filters.activityType}` : this.sql``}
        ${filters.ownerId ? this.sql`AND owner_id = ${filters.ownerId}` : this.sql``}
        ${filters.stageId ? this.sql`AND stage_id = ${filters.stageId}` : this.sql``}
      ORDER BY
        COALESCE((data->>'is_pinned')::boolean, false) DESC,
        created_at DESC
      LIMIT ${filters.limit || 50}
    `;

    return rows.map((r) => ({
      id: r.id,
      orgId: r.org_id,
      activityType: (r.data?.activity_type as any) || 'task',
      title: r.display_name,
      relatedToModule: r.data?.related_to_module || null,
      relatedToId: r.data?.related_to_id || null,
      stageId: r.stage_id,
      ownerId: r.owner_id,
      data: r.data || {},
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    }));
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdateActivityDto,
    updaterUserId?: string,
  ): Promise<ActivityItem> {
    const [existing] = await this.sql<any[]>`
      SELECT *
      FROM records
      WHERE id = ${id}
        AND org_id = ${orgId}
        AND deleted_at IS NULL
    `;

    if (!existing) {
      throw new NotFoundError(`Activity ${id} not found`);
    }

    const currentData = existing.data || {};
    const nextData: Record<string, unknown> = {
      ...currentData,
      ...(dto.data || {}),
    };

    if (dto.dueDate !== undefined) nextData.due_date = dto.dueDate;
    if (dto.priority !== undefined) nextData.priority = dto.priority;
    if (dto.outcome !== undefined) nextData.outcome = dto.outcome;
    if (dto.body !== undefined) nextData.notes = dto.body;
    if (dto.isPinned !== undefined) nextData.is_pinned = dto.isPinned;

    const nextTitle = dto.title || existing.display_name;
    const nextStageId = dto.stageId || existing.stage_id;
    const nextOwnerId = dto.assigneeId || existing.owner_id;

    const [updated] = await this.sql<any[]>`
      UPDATE records
      SET
        display_name = ${nextTitle},
        stage_id = ${nextStageId},
        owner_id = ${nextOwnerId},
        data = ${this.jsonb(nextData)}::text::jsonb,
        updated_by = ${updaterUserId || null},
        updated_at = now()
      WHERE id = ${id}
        AND org_id = ${orgId}
      RETURNING *
    `;

    return {
      id: updated.id,
      orgId: updated.org_id,
      activityType: (updated.data?.activity_type as any) || 'task',
      title: updated.display_name,
      relatedToModule: updated.data?.related_to_module || null,
      relatedToId: updated.data?.related_to_id || null,
      stageId: updated.stage_id,
      ownerId: updated.owner_id,
      data: updated.data || {},
      createdAt: new Date(updated.created_at).toISOString(),
      updatedAt: new Date(updated.updated_at).toISOString(),
    };
  }

  async delete(orgId: string, id: string): Promise<void> {
    const [row] = await this.sql<any[]>`
      UPDATE records
      SET deleted_at = now()
      WHERE id = ${id}
        AND org_id = ${orgId}
      RETURNING id
    `;

    if (!row) {
      throw new NotFoundError(`Activity ${id} not found`);
    }
  }
}
