import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import postgres from 'postgres';
import Redis from 'ioredis';
import { PG_CLIENT } from '../db/connection';
import { REDIS } from '../auth/session.service';
import { AutomationsService } from './automations.service';
import { GraphRunnerService } from './graph-runner.service';
import { ActionContext, DomainEvent } from './automations.types';
import { matchesConditions } from './conditions';

@Injectable()
export class OutboxWorkerService implements OnModuleInit, OnModuleDestroy {
  private isRunning = false;
  private loopPromise: Promise<void> | null = null;
  private subRedis: Redis | null = null;
  private wakeResolver: (() => void) | null = null;

  constructor(
    @Inject(PG_CLIENT) private readonly sql: postgres.Sql,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly automationsService: AutomationsService,
    private readonly graphRunner: GraphRunnerService,
  ) {}

  private jsonb(value: unknown): string {
    return JSON.stringify(value ?? null);
  }

  async onModuleInit() {
    if (process.env.RUN_OUTBOX_WORKER_IN_API === 'true') {
      this.start();
    }
  }

  async onModuleDestroy() {
    await this.stop();
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      this.subRedis = this.redis.duplicate();
      this.subRedis.subscribe('outbox:notify', (err) => {
        if (!err && this.wakeResolver) {
          this.wakeResolver();
        }
      });
      this.subRedis.on('message', (_channel) => {
        if (this.wakeResolver) {
          this.wakeResolver();
        }
      });
    } catch {
      this.subRedis = null;
    }

    this.loopPromise = this.pollLoop();
  }

  async stop() {
    this.isRunning = false;
    if (this.wakeResolver) {
      this.wakeResolver();
    }
    if (this.subRedis) {
      try {
        await this.subRedis.quit();
      } catch {}
      this.subRedis = null;
    }
    if (this.loopPromise) {
      await this.loopPromise;
      this.loopPromise = null;
    }
  }

  triggerWake() {
    if (this.wakeResolver) {
      this.wakeResolver();
    }
  }

  private async sleepOrWake(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let timer: NodeJS.Timeout | null = null;
      const onWake = () => {
        if (timer) clearTimeout(timer);
        this.wakeResolver = null;
        resolve();
      };
      this.wakeResolver = onWake;
      timer = setTimeout(() => {
        this.wakeResolver = null;
        resolve();
      }, ms);
    });
  }

  private async reclaimStalled(): Promise<void> {
    try {
      await this.sql`
        UPDATE outbox_events
        SET status = 'pending', last_error = COALESCE(last_error, 'reclaimed after worker restart')
        WHERE status = 'processing'
          AND created_at < now() - interval '5 minutes'
      `;
    } catch {}
  }

  private async pollLoop(): Promise<void> {
    await this.reclaimStalled();
    let ticks = 0;

    while (this.isRunning) {
      try {
        if (++ticks % 600 === 0) await this.reclaimStalled();
        const processedEvents = await this.processBatch(5);
        const resumedRuns = await this.processWaitingRuns(5);
        if (!this.isRunning) break;
        if (processedEvents > 0 || resumedRuns > 0) {
          await this.sleepOrWake(100);
        } else {
          await this.sleepOrWake(500);
        }
      } catch {
        if (!this.isRunning) break;
        await this.sleepOrWake(1000);
      }
    }
  }

  async processBatch(concurrency = 5): Promise<number> {
    const events = await this.sql<any[]>`
      UPDATE outbox_events
      SET status = 'processing', attempts = attempts
      WHERE id IN (
        SELECT id
        FROM outbox_events
        WHERE status = 'pending'
          AND available_at <= now()
        ORDER BY id ASC
        LIMIT ${concurrency}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `;

    if (!events || events.length === 0) {
      return 0;
    }

    await Promise.allSettled(
      events.map((event) => this.processSingleEvent(event)),
    );

    return events.length;
  }

  async processWaitingRuns(concurrency = 5): Promise<number> {
    const runs = await this.sql<any[]>`
      SELECT *
      FROM automation_runs
      WHERE status = 'waiting'
        AND (log->>'resumeAt')::timestamptz <= now()
      ORDER BY id ASC
      LIMIT ${concurrency}
      FOR UPDATE SKIP LOCKED
    `;

    if (!runs || runs.length === 0) {
      return 0;
    }

    await Promise.allSettled(
      runs.map((run) => this.resumeWaitingRun(run)),
    );

    return runs.length;
  }

  private async resumeWaitingRun(run: any): Promise<void> {
    const [auto] = await this.sql<any[]>`
      SELECT *
      FROM automations
      WHERE id = ${run.automation_id}
        AND org_id = ${run.org_id}
        AND is_active = true
        AND deleted_at IS NULL
    `;

    if (!auto) {
      await this.sql`
        UPDATE automation_runs
        SET
          status = 'cancelled',
          finished_at = now(),
          log = ${this.jsonb({
            ...(run.log || {}),
            reason: 'Automation was deactivated or deleted during wait period',
          })}::text::jsonb
        WHERE id = ${run.id}
      `;
      return;
    }

    let currentRecord: any = null;
    if (run.record_id) {
      const [rec] = await this.sql<any[]>`
        SELECT id, display_name, data, stage_id, pipeline_id, owner_id, deleted_at
        FROM records
        WHERE id = ${run.record_id}
          AND org_id = ${run.org_id}
      `;

      if (!rec || rec.deleted_at) {
        await this.sql`
          UPDATE automation_runs
          SET
            status = 'cancelled',
            finished_at = now(),
            log = ${this.jsonb({
              ...(run.log || {}),
              reason: 'Record was deleted during wait period',
            })}::text::jsonb
          WHERE id = ${run.id}
        `;
        return;
      }

      currentRecord = {
        id: rec.id,
        displayName: rec.display_name,
        data: rec.data || {},
        stageId: rec.stage_id,
        pipelineId: rec.pipeline_id,
        ownerId: rec.owner_id,
      };
    }

    const syntheticEvent: DomainEvent = {
      id: `resume_${run.id}`,
      orgId: run.org_id,
      type: auto.trigger?.eventType || 'record.resumed',
      moduleKey: auto.trigger?.moduleKey,
      recordId: run.record_id,
      aggregateId: run.record_id || auto.id,
      actor: { id: null, type: 'automation' },
      occurredAt: new Date().toISOString(),
      snapshot: {
        display_name: currentRecord?.displayName,
        data: currentRecord?.data || {},
        stage_id: currentRecord?.stageId,
        pipeline_id: currentRecord?.pipelineId,
        owner_id: currentRecord?.ownerId,
      },
    };

    const conditionsMatch = matchesConditions(
      auto.conditions,
      currentRecord,
      syntheticEvent,
    );

    if (!conditionsMatch) {
      const updatedSteps = [
        ...(run.log?.steps || []),
        {
          nodeId: 'wait_recheck',
          type: 'wait',
          status: 'cancelled',
          output: 'Original conditions failed re-evaluation on resume',
          timestamp: new Date().toISOString(),
        },
      ];
      await this.sql`
        UPDATE automation_runs
        SET
          status = 'cancelled',
          finished_at = now(),
          log = ${this.jsonb({
            ...(run.log || {}),
            steps: updatedSteps,
            reason: 'Conditions failed re-evaluation on resume',
          })}::text::jsonb
        WHERE id = ${run.id}
      `;
      return;
    }

    const resolveTemplate = (tpl: string): string => {
      if (!tpl || typeof tpl !== 'string') return '';
      return tpl.replace(/\{\{([\w\.]+)\}\}/g, (_, key) => {
        if (key === 'id') return String(run.record_id || '');
        if (key === 'displayName' || key === 'display_name') return String(currentRecord?.displayName || '');
        if (key.startsWith('data.')) {
          const subKey = key.slice(5);
          const val = currentRecord?.data?.[subKey];
          return val != null ? String(val) : '';
        }
        if (currentRecord?.data?.[key] != null) return String(currentRecord.data[key]);
        return '';
      });
    };

    const context: ActionContext = {
      orgId: run.org_id,
      event: syntheticEvent,
      record: currentRecord,
      resolve: resolveTemplate,
      sql: this.sql,
      redis: this.redis,
    };

    const result = await this.graphRunner.executeGraph(auto.actions, context, {
      startNodeId: run.log?.currentNodeId,
      existingSteps: run.log?.steps,
      completedNodeIds: run.log?.completedNodeIds,
      runId: run.id,
    });

    if (result.status === 'waiting') {
      await this.sql`
        UPDATE automation_runs
        SET
          log = ${this.jsonb({
            steps: result.steps,
            completedNodeIds: result.completedNodeIds,
            currentNodeId: result.currentNodeId,
            resumeAt: result.resumeAt,
          })}::text::jsonb
        WHERE id = ${run.id}
      `;
    } else if (result.status === 'success') {
      await this.sql`
        UPDATE automation_runs
        SET
          status = 'success',
          finished_at = now(),
          log = ${this.jsonb({
            steps: result.steps,
            completedNodeIds: result.completedNodeIds,
            finalState: result.finalState,
          })}::text::jsonb
        WHERE id = ${run.id}
      `;
    } else {
      await this.sql`
        UPDATE automation_runs
        SET
          status = 'failed',
          finished_at = now(),
          log = ${this.jsonb({
            steps: result.steps,
            completedNodeIds: result.completedNodeIds,
            error: result.error,
          })}::text::jsonb
        WHERE id = ${run.id}
      `;
    }
  }

  private async processSingleEvent(event: any): Promise<void> {
    const payload = event.payload || {};
    const moduleKey = payload.moduleKey;
    const recordId = payload.recordId || event.aggregate_id;
    const causationChain: string[] = Array.isArray(payload.causationChain) ? payload.causationChain : [];

    let currentRecord: any = null;
    if (recordId) {
      try {
        const [rec] = await this.sql<any[]>`
          SELECT id, display_name, data, stage_id, pipeline_id, owner_id
          FROM records
          WHERE id = ${recordId} AND org_id = ${event.org_id}
        `;
        if (rec) {
          currentRecord = {
            id: rec.id,
            displayName: rec.display_name,
            data: rec.data || {},
            stageId: rec.stage_id,
            pipelineId: rec.pipeline_id,
            ownerId: rec.owner_id,
          };
        }
      } catch {}
    }

    const domainEvent: DomainEvent = {
      id: event.id,
      orgId: event.org_id,
      type: event.event_type,
      moduleKey,
      recordId,
      aggregateId: event.aggregate_id,
      actor: { id: payload.actorId || null, type: 'user' },
      occurredAt: event.created_at,
      changes: payload.changes,
      snapshot: payload.snapshot || {
        display_name: payload.displayName || currentRecord?.displayName,
        data: payload.data || currentRecord?.data || {},
        stage_id: currentRecord?.stageId,
        pipeline_id: currentRecord?.pipelineId,
        owner_id: currentRecord?.ownerId,
      },
      causationChain,
      payload,
    };

    const resolveTemplate = (tpl: string): string => {
      if (!tpl || typeof tpl !== 'string') return '';
      return tpl.replace(/\{\{([\w\.]+)\}\}/g, (_, key) => {
        if (key === 'id') return String(recordId || '');
        if (key === 'displayName' || key === 'display_name') return String(currentRecord?.displayName || payload.displayName || '');
        if (key === 'moduleKey' || key === 'module_key') return String(moduleKey || '');
        if (key === 'eventType' || key === 'event_type') return String(event.event_type || '');
        if (key.startsWith('data.')) {
          const subKey = key.slice(5);
          const val = currentRecord?.data?.[subKey] ?? payload.data?.[subKey];
          return val != null ? String(val) : '';
        }
        if (currentRecord?.data?.[key] != null) return String(currentRecord.data[key]);
        if (payload.data?.[key] != null) return String(payload.data[key]);
        if (payload[key] != null) return String(payload[key]);
        return '';
      });
    };

    const context: ActionContext = {
      orgId: event.org_id,
      event: domainEvent,
      record: currentRecord,
      resolve: resolveTemplate,
      sql: this.sql,
      redis: this.redis,
    };

    let matchingAutomations: any[] = [];
    try {
      matchingAutomations = await this.automationsService.getMatchingAutomations(
        event.org_id,
        event.event_type,
        moduleKey,
        domainEvent.changes ? Object.keys(domainEvent.changes) : undefined,
      );
      matchingAutomations = matchingAutomations.filter((auto) =>
        matchesConditions(auto.conditions, currentRecord, domainEvent),
      );
    } catch (err: any) {
      await this.handleEventFailure(event, err.message || 'Failed to query automations');
      return;
    }

    if (matchingAutomations.length === 0) {
      await this.sql`
        UPDATE outbox_events
        SET status = 'done', processed_at = now()
        WHERE id = ${event.id}
      `;
      return;
    }

    let hasFailure = false;
    let lastErrorMessage: string | null = null;

    for (const auto of matchingAutomations) {
      if (causationChain.includes(auto.id)) {
        await this.sql`
          INSERT INTO automation_runs (
            org_id,
            automation_id,
            record_id,
            status,
            log,
            started_at,
            finished_at
          ) VALUES (
            ${event.org_id},
            ${auto.id},
            ${recordId || null},
            'skipped',
            ${this.jsonb({ reason: 'Loop protection: automation already in causation chain' })}::text::jsonb,
            now(),
            now()
          )
        `;
        continue;
      }

      if (causationChain.length >= 10) {
        hasFailure = true;
        lastErrorMessage = 'Loop protection: max causation chain depth (10) reached';
        await this.sql`
          INSERT INTO automation_runs (
            org_id,
            automation_id,
            record_id,
            status,
            log,
            started_at,
            finished_at
          ) VALUES (
            ${event.org_id},
            ${auto.id},
            ${recordId || null},
            'failed',
            ${this.jsonb({ error: lastErrorMessage })}::text::jsonb,
            now(),
            now()
          )
        `;
        continue;
      }

      if (recordId) {
        const rateKey = `crm:rate:record:${recordId}:${new Date().getUTCHours()}`;
        try {
          const currentCount = await this.redis.incr(rateKey);
          if (currentCount === 1) {
            await this.redis.expire(rateKey, 3600);
          }
          if (currentCount > 50) {
            hasFailure = true;
            lastErrorMessage = 'Loop protection: hourly execution limit (50) exceeded';
            await this.sql`
              INSERT INTO automation_runs (
                org_id,
                automation_id,
                record_id,
                status,
                log,
                started_at,
                finished_at
              ) VALUES (
                ${event.org_id},
                ${auto.id},
                ${recordId || null},
                'failed',
                ${this.jsonb({ error: lastErrorMessage })}::text::jsonb,
                now(),
                now()
              )
            `;
            continue;
          }
        } catch {}
      }

      const [runRecord] = await this.sql<any[]>`
        INSERT INTO automation_runs (
          org_id,
          automation_id,
          record_id,
          status,
          started_at
        ) VALUES (
          ${event.org_id},
          ${auto.id},
          ${recordId || null},
          'running',
          now()
        )
        RETURNING id
      `;

      try {
        const result = await this.graphRunner.executeGraph(auto.actions, context, {
          runId: runRecord.id,
        });

        if (result.status === 'waiting') {
          await this.sql`
            UPDATE automation_runs
            SET
              status = 'waiting',
              log = ${this.jsonb({
                steps: result.steps,
                completedNodeIds: result.completedNodeIds,
                currentNodeId: result.currentNodeId,
                resumeAt: result.resumeAt,
                causationChain,
              })}::text::jsonb
            WHERE id = ${runRecord.id}
          `;
        } else if (result.status === 'success') {
          await this.sql`
            UPDATE automation_runs
            SET
              status = 'success',
              finished_at = now(),
              log = ${this.jsonb({
                steps: result.steps,
                completedNodeIds: result.completedNodeIds,
                finalState: result.finalState,
              })}::text::jsonb
            WHERE id = ${runRecord.id}
          `;
        } else {
          hasFailure = true;
          lastErrorMessage = result.error || 'Graph execution failed';
          await this.sql`
            UPDATE automation_runs
            SET
              status = 'failed',
              finished_at = now(),
              log = ${this.jsonb({
                steps: result.steps,
                completedNodeIds: result.completedNodeIds,
                error: lastErrorMessage,
                attempt: (event.attempts || 0) + 1,
              })}::text::jsonb
            WHERE id = ${runRecord.id}
          `;
        }
      } catch (err: any) {
        hasFailure = true;
        lastErrorMessage = err.message || String(err);
        await this.sql`
          UPDATE automation_runs
          SET
            status = 'failed',
            finished_at = now(),
            log = ${this.jsonb({
              error: lastErrorMessage,
              attempt: (event.attempts || 0) + 1,
            })}::text::jsonb
          WHERE id = ${runRecord.id}
        `;
      }
    }

    if (hasFailure) {
      await this.handleEventFailure(event, lastErrorMessage || 'One or more automations failed');
    } else {
      await this.sql`
        UPDATE outbox_events
        SET status = 'done', processed_at = now()
        WHERE id = ${event.id}
      `;
    }
  }

  private async handleEventFailure(event: any, errorMessage: string): Promise<void> {
    const nextAttempts = (event.attempts || 0) + 1;
    const maxAttempts = 5;

    if (nextAttempts >= maxAttempts) {
      await this.sql`
        UPDATE outbox_events
        SET
          status = 'dead_letter',
          attempts = ${nextAttempts},
          last_error = ${errorMessage},
          processed_at = now()
        WHERE id = ${event.id}
      `;
      return;
    }

    const backoffSeconds = process.env.FAST_RETRY === 'true'
      ? 1
      : Math.min(Math.pow(2, nextAttempts) * 10, 3600);
    await this.sql`
      UPDATE outbox_events
      SET
        status = 'pending',
        attempts = ${nextAttempts},
        last_error = ${errorMessage},
        available_at = now() + (${backoffSeconds} || ' seconds')::interval
      WHERE id = ${event.id}
    `;
  }
}
