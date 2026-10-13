import { Injectable, Inject } from '@nestjs/common';
import postgres from 'postgres';
import Redis from 'ioredis';
import { PG_CLIENT } from '../db/connection';
import { REDIS } from '../auth/session.service';
import { CalendarService } from './calendar.service';
import {
  CreateRuleDto,
  UpdateRuleDto,
  RuleKind,
} from './routing.types';
import { NotFoundError, ValidationError } from '../common/errors';
import { matchesConditions } from '../automations/conditions';

@Injectable()
export class RoutingService {
  constructor(
    @Inject(PG_CLIENT) private readonly sql: postgres.Sql,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly calendarService: CalendarService,
  ) {}

  private jsonb(value: unknown): string {
    return JSON.stringify(value ?? {});
  }

  async createRule(orgId: string, dto: CreateRuleDto): Promise<any> {
    if (!dto.name || !dto.name.trim()) {
      throw new ValidationError('Rule name is required', [{ field: 'name', message: 'Name is required' }]);
    }
    if (!dto.kind) {
      throw new ValidationError('Rule kind is required', [{ field: 'kind', message: 'Kind is required' }]);
    }
    if (!dto.moduleId) {
      throw new ValidationError('Module ID is required', [{ field: 'moduleId', message: 'Module ID is required' }]);
    }

    const [created] = await this.sql<any[]>`
      INSERT INTO rules (
        org_id,
        module_id,
        kind,
        name,
        conditions,
        config,
        priority,
        is_active
      ) VALUES (
        ${orgId},
        ${dto.moduleId},
        ${dto.kind},
        ${dto.name.trim()},
        ${this.jsonb(dto.conditions || {})},
        ${this.jsonb(dto.config || {})},
        ${dto.priority ?? 0},
        ${dto.isActive ?? true}
      )
      RETURNING *
    `;

    return created;
  }

  async updateRule(orgId: string, id: string, dto: UpdateRuleDto): Promise<any> {
    const [existing] = await this.sql<any[]>`
      SELECT *
      FROM rules
      WHERE id = ${id}
        AND org_id = ${orgId}
    `;

    if (!existing) {
      throw new NotFoundError(`Rule ${id} not found`);
    }

    const [updated] = await this.sql<any[]>`
      UPDATE rules
      SET
        name = COALESCE(${dto.name?.trim() ?? null}, name),
        conditions = COALESCE(${dto.conditions !== undefined ? this.jsonb(dto.conditions) : null}::text::jsonb, conditions),
        config = COALESCE(${dto.config ? this.jsonb(dto.config) : null}::text::jsonb, config),
        priority = COALESCE(${dto.priority ?? null}, priority),
        is_active = COALESCE(${dto.isActive ?? null}, is_active),
        updated_at = now()
      WHERE id = ${id}
        AND org_id = ${orgId}
      RETURNING *
    `;

    return updated;
  }

  async deleteRule(orgId: string, id: string): Promise<void> {
    const [row] = await this.sql<any[]>`
      DELETE FROM rules
      WHERE id = ${id}
        AND org_id = ${orgId}
      RETURNING id
    `;

    if (!row) {
      throw new NotFoundError(`Rule ${id} not found`);
    }
  }

  async getRule(orgId: string, id: string): Promise<any> {
    const [rule] = await this.sql<any[]>`
      SELECT *
      FROM rules
      WHERE id = ${id}
        AND org_id = ${orgId}
    `;

    if (!rule) {
      throw new NotFoundError(`Rule ${id} not found`);
    }

    return rule;
  }

  async listRules(orgId: string, moduleId?: string, kind?: RuleKind): Promise<any[]> {
    const rows = await this.sql<any[]>`
      SELECT *
      FROM rules
      WHERE org_id = ${orgId}
        ${moduleId ? this.sql`AND module_id = ${moduleId}` : this.sql``}
        ${kind ? this.sql`AND kind = ${kind}` : this.sql``}
      ORDER BY priority DESC, created_at ASC
    `;

    return rows;
  }

  async evaluateAssignment(
    orgId: string,
    moduleId: string,
    recordData: Record<string, unknown>,
    currentOwnerId?: string | null,
    evaluationDate?: Date,
  ): Promise<{ ownerId: string | null; ruleId?: string; ruleName?: string; strategy?: string }> {
    const rules = await this.listRules(orgId, moduleId, 'assignment');
    const isWorkingHours = await this.calendarService.isWithinWorkingHours(orgId, evaluationDate);

    for (const rule of rules) {
      if (!rule.is_active) continue;

      const syntheticEvent: any = {
        id: `eval_${Date.now()}`,
        orgId,
        type: 'record.evaluating',
        snapshot: { data: recordData },
      };

      const matched = matchesConditions(rule.conditions, { data: recordData }, syntheticEvent);
      if (!matched) continue;

      const config = rule.config || {};
      const respectWorkingHours = Boolean(config.respectWorkingHours);

      if (respectWorkingHours && !isWorkingHours) {
        if (config.fallbackOwnerId) {
          return {
            ownerId: config.fallbackOwnerId,
            ruleId: rule.id,
            ruleName: rule.name,
            strategy: 'fallback_outside_working_hours',
          };
        }
        continue;
      }

      const strategy = config.strategy || 'fixed';

      if (strategy === 'keep_existing' && currentOwnerId) {
        return {
          ownerId: currentOwnerId,
          ruleId: rule.id,
          ruleName: rule.name,
          strategy: 'keep_existing',
        };
      }

      if (strategy === 'fixed' && (config.ownerId || config.userId)) {
        return {
          ownerId: config.ownerId || config.userId,
          ruleId: rule.id,
          ruleName: rule.name,
          strategy: 'fixed',
        };
      }

      if (strategy === 'round_robin' && Array.isArray(config.pool) && config.pool.length > 0) {
        const pool: string[] = config.pool;
        const activeUsers = await this.sql<any[]>`
          SELECT id
          FROM users
          WHERE id = ANY(${pool})
            AND org_id = ${orgId}
            AND is_active = true
        `;

        if (activeUsers.length > 0) {
          const userIds = activeUsers.map((u) => u.id);
          const counterKey = `assignment:rr:rule:${rule.id}`;
          const count = await this.redis.incr(counterKey);
          const selectedIndex = Math.abs(count) % userIds.length;
          return {
            ownerId: userIds[selectedIndex],
            ruleId: rule.id,
            ruleName: rule.name,
            strategy: 'round_robin',
          };
        }
      }

      if (strategy === 'load_balanced' && Array.isArray(config.pool) && config.pool.length > 0) {
        const pool: string[] = config.pool;
        const counts = await this.sql<any[]>`
          SELECT u.id, COUNT(r.id)::int as open_count
          FROM users u
          LEFT JOIN records r ON r.owner_id = u.id AND r.deleted_at IS NULL AND r.org_id = ${orgId}
          WHERE u.id = ANY(${pool})
            AND u.org_id = ${orgId}
            AND u.is_active = true
          GROUP BY u.id
          ORDER BY open_count ASC
        `;

        if (counts.length > 0) {
          return {
            ownerId: counts[0].id,
            ruleId: rule.id,
            ruleName: rule.name,
            strategy: 'load_balanced',
          };
        }
      }

      if (strategy === 'by_field_value' && config.fieldKey && config.mapping) {
        const val = String(recordData[config.fieldKey] || '');
        const targetUserId = config.mapping[val] || config.fallbackOwnerId || null;
        if (targetUserId) {
          return {
            ownerId: targetUserId,
            ruleId: rule.id,
            ruleName: rule.name,
            strategy: 'by_field_value',
          };
        }
      }
    }

    return { ownerId: null };
  }

  async calculateLeadScore(
    orgId: string,
    moduleId: string,
    recordData: Record<string, unknown>,
  ): Promise<{ score: number; contributingRules: Array<{ name: string; points: number }> }> {
    const rules = await this.listRules(orgId, moduleId, 'scoring');
    let totalScore = 0;
    const contributingRules: Array<{ name: string; points: number }> = [];

    for (const rule of rules) {
      if (!rule.is_active) continue;

      const syntheticEvent: any = {
        id: `eval_score_${Date.now()}`,
        orgId,
        type: 'record.evaluating',
        snapshot: { data: recordData },
      };

      const matched = matchesConditions(rule.conditions, { data: recordData }, syntheticEvent);
      if (matched) {
        const points = Number(rule.config?.points || 0);
        totalScore += points;
        contributingRules.push({
          name: rule.name,
          points,
        });
      }
    }

    return { score: totalScore, contributingRules };
  }
}
