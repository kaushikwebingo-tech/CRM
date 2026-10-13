import { Injectable, Inject } from '@nestjs/common';
import postgres from 'postgres';
import { PG_CLIENT } from '../db/connection';
import { CalendarService } from './calendar.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SlaInstanceItem } from './routing.types';
import { matchesConditions } from '../automations/conditions';

@Injectable()
export class SlaService {
  constructor(
    @Inject(PG_CLIENT) private readonly sql: postgres.Sql,
    private readonly calendarService: CalendarService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private jsonb(value: unknown): string {
    return JSON.stringify(value ?? {});
  }

  async attachSlaToRecord(orgId: string, moduleId: string, record: any): Promise<void> {
    const rules = await this.sql<any[]>`
      SELECT *
      FROM rules
      WHERE org_id = ${orgId}
        AND module_id = ${moduleId}
        AND kind = 'sla'
        AND is_active = true
      ORDER BY priority DESC, created_at ASC
    `;

    const recordData = record.data || {};
    const syntheticEvent: any = {
      id: `eval_sla_${Date.now()}`,
      orgId,
      type: 'record.created',
      snapshot: { data: recordData, stage_id: record.stage_id, owner_id: record.owner_id },
    };

    for (const rule of rules) {
      const matches = matchesConditions(
        rule.conditions,
        { data: recordData, stageId: record.stage_id, ownerId: record.owner_id },
        syntheticEvent,
      );

      if (!matches) continue;

      const [existing] = await this.sql<any[]>`
        SELECT id
        FROM sla_instances
        WHERE rule_id = ${rule.id}
          AND record_id = ${record.id}
          AND status = 'active'
        LIMIT 1
      `;

      if (existing) continue;

      const config = rule.config || {};
      const targetMinutes = Number(config.targetMinutes || 60);
      const businessHoursOnly = config.businessHoursOnly !== false;
      const startedAt = new Date();
      const targetAt = await this.calendarService.calculateTargetTime(
        orgId,
        startedAt,
        targetMinutes,
        businessHoursOnly,
      );

      await this.sql`
        INSERT INTO sla_instances (
          org_id,
          rule_id,
          record_id,
          status,
          target_minutes,
          business_hours_only,
          started_at,
          target_at,
          escalations_fired
        ) VALUES (
          ${orgId},
          ${rule.id},
          ${record.id},
          'active',
          ${targetMinutes},
          ${businessHoursOnly},
          ${startedAt.toISOString()},
          ${targetAt.toISOString()},
          '[]'::jsonb
        )
      `;
    }
  }

  async evaluateSlas(orgId: string, testSimulatedDate?: Date): Promise<{ evaluated: number; escalated: number; breached: number }> {
    const activeInstances = await this.sql<any[]>`
      SELECT
        s.*,
        r.conditions as rule_conditions,
        r.config as rule_config,
        r.name as rule_name,
        rec.id as rec_id,
        rec.display_name as rec_display_name,
        rec.data as rec_data,
        rec.stage_id as rec_stage_id,
        rec.owner_id as rec_owner_id,
        rec.module_id as rec_module_id
      FROM sla_instances s
      JOIN rules r ON r.id = s.rule_id
      JOIN records rec ON rec.id = s.record_id
      WHERE s.org_id = ${orgId}
        AND s.status = 'active'
        AND rec.deleted_at IS NULL
    `;

    let evaluated = 0;
    let escalated = 0;
    let breached = 0;

    const now = testSimulatedDate || new Date();

    for (const inst of activeInstances) {
      evaluated++;
      const config = inst.rule_config || {};
      const record = {
        id: inst.rec_id,
        displayName: inst.rec_display_name,
        data: inst.rec_data || {},
        stageId: inst.rec_stage_id,
        ownerId: inst.rec_owner_id,
      };

      if (config.stopOn && Object.keys(config.stopOn).length > 0) {
        const stopSyntheticEvent: any = {
          id: `sla_stop_${inst.id}`,
          orgId,
          type: 'record.updated',
          snapshot: { data: record.data, stage_id: record.stageId, owner_id: record.ownerId },
        };

        const shouldStop = matchesConditions(
          config.stopOn,
          { data: record.data, stageId: record.stageId, ownerId: record.ownerId },
          stopSyntheticEvent,
        );

        if (shouldStop) {
          await this.sql`
            UPDATE sla_instances
            SET status = 'fulfilled', fulfilled_at = now()
            WHERE id = ${inst.id}
          `;
          continue;
        }
      }

      const startedAt = new Date(inst.started_at);
      const targetAt = new Date(inst.target_at);
      const totalDuration = targetAt.getTime() - startedAt.getTime();
      const elapsed = now.getTime() - startedAt.getTime();
      const percent = totalDuration > 0 ? (elapsed / totalDuration) * 100 : 100;

      const escalations = Array.isArray(config.escalations) ? config.escalations : [];
      const firedList: number[] = Array.isArray(inst.escalations_fired)
        ? inst.escalations_fired.map((e: any) => typeof e === 'number' ? e : e.atPercent)
        : [];

      for (const esc of escalations) {
        const atPercent = Number(esc.atPercent || 100);
        if (percent >= atPercent && !firedList.includes(atPercent)) {
          escalated++;
          firedList.push(atPercent);

          const notifyList = Array.isArray(esc.notify) ? esc.notify : [];
          if (notifyList.includes('owner') && record.ownerId) {
            await this.notificationsService.notifyOwner(
              orgId,
              record.ownerId,
              'sla_escalation',
              `SLA Escalation (${atPercent}%): ${record.displayName}`,
              `SLA threshold reached for rule "${inst.rule_name}" on record ${record.displayName}`,
              { recordId: record.id, ruleId: inst.rule_id, atPercent },
            );
          }

          if (notifyList.includes('manager')) {
            const [adminUser] = await this.sql<any[]>`
              SELECT id FROM users WHERE org_id = ${orgId} AND is_active = true ORDER BY created_at ASC LIMIT 1
            `;
            if (adminUser) {
              await this.notificationsService.notifyOwner(
                orgId,
                adminUser.id,
                'sla_escalation',
                `SLA Escalation (${atPercent}%): ${record.displayName}`,
                `Management escalation for rule "${inst.rule_name}" on record ${record.displayName}`,
                { recordId: record.id, ruleId: inst.rule_id, atPercent },
              );
            }
          }

          if (esc.reassign) {
            await this.sql`
              UPDATE records
              SET owner_id = ${esc.reassign}, updated_at = now()
              WHERE id = ${record.id}
            `;
          }

          await this.sql`
            INSERT INTO record_events (
              org_id,
              record_id,
              module_id,
              type,
              actor_type,
              payload
            ) VALUES (
              ${orgId},
              ${record.id},
              ${inst.rec_module_id},
              'sla.escalated',
              'system',
              ${this.jsonb({
                ruleId: inst.rule_id,
                ruleName: inst.rule_name,
                atPercent,
                reassignedTo: esc.reassign || null,
              })}::text::jsonb
            )
          `;
        }
      }

      await this.sql`
        UPDATE sla_instances
        SET escalations_fired = ${this.jsonb(firedList)}::text::jsonb
        WHERE id = ${inst.id}
      `;

      if (percent >= 100) {
        breached++;
        await this.sql`
          UPDATE sla_instances
          SET status = 'breached', breached_at = now()
          WHERE id = ${inst.id}
        `;

        await this.sql`
          INSERT INTO record_events (
            org_id,
            record_id,
            module_id,
            type,
            actor_type,
            payload
          ) VALUES (
            ${orgId},
            ${record.id},
            ${inst.rec_module_id},
            'sla.breached',
            'system',
            ${this.jsonb({
              ruleId: inst.rule_id,
              ruleName: inst.rule_name,
              targetMinutes: inst.target_minutes,
            })}::text::jsonb
          )
        `;
      }
    }

    return { evaluated, escalated, breached };
  }

  async getSlasForRecord(orgId: string, recordId: string): Promise<SlaInstanceItem[]> {
    const rows = await this.sql<any[]>`
      SELECT *
      FROM sla_instances
      WHERE org_id = ${orgId}
        AND record_id = ${recordId}
      ORDER BY created_at DESC
    `;

    return rows.map((r) => ({
      id: r.id,
      orgId: r.org_id,
      ruleId: r.rule_id,
      recordId: r.record_id,
      status: r.status,
      targetMinutes: r.target_minutes,
      businessHoursOnly: r.business_hours_only,
      startedAt: new Date(r.started_at).toISOString(),
      targetAt: new Date(r.target_at).toISOString(),
      escalationsFired: Array.isArray(r.escalations_fired) ? r.escalations_fired : [],
      fulfilledAt: r.fulfilled_at ? new Date(r.fulfilled_at).toISOString() : null,
      breachedAt: r.breached_at ? new Date(r.breached_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }
}
