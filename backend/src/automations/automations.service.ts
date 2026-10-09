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
        ${JSON.stringify(dto.trigger ?? null)}::text::jsonb,
        ${dto.conditions ? JSON.stringify(dto.conditions) : null}::text::jsonb,
        ${JSON.stringify(dto.actions ?? [])}::text::jsonb
      )
      RETURNING *
    `;

    return created;
  }

  async update(orgId: string, id: string, dto: UpdateAutomationDto): Promise<Automation> {
    const current = await this.getById(orgId, id);

    const next = {
      name: dto.name !== undefined ? dto.name.trim() : (current as any).name,
      moduleId: dto.moduleId !== undefined ? dto.moduleId : (current as any).module_id,
      isActive: dto.isActive !== undefined ? dto.isActive : (current as any).is_active,
      trigger: dto.trigger !== undefined ? dto.trigger : (current as any).trigger,
      conditions: dto.conditions !== undefined ? dto.conditions : (current as any).conditions,
      actions: dto.actions !== undefined ? dto.actions : (current as any).actions,
    };

    if (!next.name) {
      throw new ValidationError('Name is required', [{ field: 'name', message: 'Name is required' }]);
    }
    if (!Array.isArray(next.actions) || next.actions.length === 0) {
      throw new ValidationError('At least one action is required', [
        { field: 'actions', message: 'At least one action is required' },
      ]);
    }

    const [updated] = await this.sql<Automation[]>`
      UPDATE automations
      SET
        name = ${next.name},
        module_id = ${next.moduleId ?? null},
        is_active = ${next.isActive ?? false},
        trigger = ${JSON.stringify(next.trigger ?? null)}::text::jsonb,
        conditions = ${next.conditions ? JSON.stringify(next.conditions) : null}::text::jsonb,
        actions = ${JSON.stringify(next.actions ?? [])}::text::jsonb
      WHERE id = ${id}
        AND org_id = ${orgId}
        AND deleted_at IS NULL
      RETURNING *
    `;

    if (!updated) {
      throw new NotFoundError(`Automation ${id} not found`);
    }
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

  async getMatchingAutomations(
    orgId: string,
    eventType: string,
    moduleKey?: string,
    changedKeys?: string[],
  ): Promise<Automation[]> {
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
     
      const watched = trig.fieldKeys || trig.field_keys;
      if (Array.isArray(watched) && watched.length > 0) {
        if (!changedKeys || changedKeys.length === 0) return false;
        if (!watched.some((k: string) => changedKeys.includes(k))) return false;
      }
      return true;
    });
  }
}
