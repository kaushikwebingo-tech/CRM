import { Injectable, Inject } from '@nestjs/common';
import postgres from 'postgres';
import { PG_CLIENT } from '../db/connection';
import { NotFoundError, ValidationError } from '../common/errors';
import { Automation, AutomationRun } from './automations.types';

export interface CreateAutomationDto {
  name: string;
  moduleId?: string | null;
  isActive?: boolean;
  trigger: {
    eventType: string;
    moduleKey?: string;
    [key: string]: unknown;
  };
  conditions?: Record<string, unknown> | null;
  actions: Array<{
    type: string;
    config: Record<string, unknown>;
  }>;
}

export interface UpdateAutomationDto {
  name?: string;
  moduleId?: string | null;
  isActive?: boolean;
  trigger?: {
    eventType: string;
    moduleKey?: string;
    [key: string]: unknown;
  };
  conditions?: Record<string, unknown> | null;
  actions?: Array<{
    type: string;
    config: Record<string, unknown>;
  }>;
}

@Injectable()
export class AutomationsService {
  constructor(@Inject(PG_CLIENT) private readonly sql: postgres.Sql) {}

  async list(orgId: string, moduleId?: string): Promise<Automation[]> {
    const rows = moduleId
      ? await this.sql<Automation[]>`
          SELECT *
          FROM automations
          WHERE org_id = ${orgId}
            AND module_id = ${moduleId}
            AND deleted_at IS NULL
          ORDER BY created_at DESC
        `
      : await this.sql<Automation[]>`
          SELECT *
          FROM automations
          WHERE org_id = ${orgId}
            AND deleted_at IS NULL
          ORDER BY created_at DESC
        `;
    return rows;
  }

  async getById(orgId: string, id: string): Promise<Automation> {
    const [row] = await this.sql<Automation[]>`
      SELECT *
      FROM automations
      WHERE id = ${id}
        AND org_id = ${orgId}
        AND deleted_at IS NULL
    `;
    if (!row) {
      throw new NotFoundError(`Automation ${id} not found`);
    }
    return row;
  }

  async create(orgId: string, dto: CreateAutomationDto): Promise<Automation> {
    if (!dto.name || !dto.name.trim()) {
      throw new ValidationError('Name is required', [{ field: 'name', message: 'Name is required' }]);
    }
    if (!dto.trigger || !dto.trigger.eventType) {
      throw new ValidationError('Trigger eventType is required', [
        { field: 'trigger.eventType', message: 'Trigger eventType is required' },
      ]);
    }
    if (!Array.isArray(dto.actions) || dto.actions.length === 0) {
      throw new ValidationError('At least one action is required', [
        { field: 'actions', message: 'At least one action is required' },
      ]);
    }

    const [created] = await this.sql<Automation[]>`
      INSERT INTO automations (
        org_id,
        module_id,
        name,
        is_active,
        trigger,
        conditions,
        actions
      ) VALUES (
        ${orgId},
        ${dto.moduleId || null},
        ${dto.name.trim()},
        ${dto.isActive ?? true},
        ${JSON.stringify(dto.trigger)}::jsonb,
        ${dto.conditions ? JSON.stringify(dto.conditions) : null}::jsonb,
        ${JSON.stringify(dto.actions)}::jsonb
      )
      RETURNING *
    `;

    return created;
  }

  async update(orgId: string, id: string, dto: UpdateAutomationDto): Promise<Automation> {
    await this.getById(orgId, id);

    const updates: Record<string, any> = {};
    if (dto.name !== undefined) updates.name = dto.name.trim();
    if (dto.moduleId !== undefined) updates.module_id = dto.moduleId;
    if (dto.isActive !== undefined) updates.is_active = dto.isActive;
    if (dto.trigger !== undefined) updates.trigger = dto.trigger;
    if (dto.conditions !== undefined) updates.conditions = dto.conditions;
    if (dto.actions !== undefined) updates.actions = dto.actions;

    const [updated] = await this.sql<Automation[]>`
      UPDATE automations
      SET
        name = COALESCE(${updates.name ?? null}, name),
        module_id = CASE WHEN ${updates.module_id !== undefined} THEN ${updates.module_id} ELSE module_id END,
        is_active = COALESCE(${updates.is_active ?? null}, is_active),
        trigger = CASE WHEN ${updates.trigger !== undefined} THEN ${JSON.stringify(updates.trigger)}::jsonb ELSE trigger END,
        conditions = CASE WHEN ${updates.conditions !== undefined} THEN ${updates.conditions ? JSON.stringify(updates.conditions) : null}::jsonb ELSE conditions END,
        actions = CASE WHEN ${updates.actions !== undefined} THEN ${JSON.stringify(updates.actions)}::jsonb ELSE actions END
      WHERE id = ${id}
        AND org_id = ${orgId}
        AND deleted_at IS NULL
      RETURNING *
    `;

    return updated;
  }

  async delete(orgId: string, id: string): Promise<void> {
    await this.getById(orgId, id);
    await this.sql`
      UPDATE automations
      SET deleted_at = now()
      WHERE id = ${id} AND org_id = ${orgId}
    `;
  }

  async listRuns(orgId: string, automationId: string, limit = 50): Promise<AutomationRun[]> {
    const rows = await this.sql<AutomationRun[]>`
      SELECT *
      FROM automation_runs
      WHERE automation_id = ${automationId}
        AND org_id = ${orgId}
      ORDER BY started_at DESC
      LIMIT ${limit}
    `;
    return rows;
  }

  async getMatchingAutomations(orgId: string, eventType: string, moduleKey?: string): Promise<Automation[]> {
    const rows = await this.sql<Automation[]>`
      SELECT *
      FROM automations
      WHERE org_id = ${orgId}
        AND is_active = true
        AND deleted_at IS NULL
    `;

    return rows.filter((auto) => {
      const trig = auto.trigger as any;
      if (!trig) return false;
      const trigEvent = trig.eventType || trig.event_type || trig.event;
      if (trigEvent !== '*' && trigEvent !== eventType) {
        return false;
      }
      const trigModule = trig.moduleKey || trig.module_key || trig.module;
      if (trigModule && moduleKey && trigModule !== moduleKey) {
        return false;
      }
      return true;
    });
  }
}
