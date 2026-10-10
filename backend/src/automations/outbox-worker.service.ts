import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import postgres from 'postgres';
import Redis from 'ioredis';
import { PG_CLIENT } from '../db/connection';
import { REDIS } from '../auth/session.service';
import { AutomationsService } from './automations.service';
import { getActionHandler } from './actions/action-registry';
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
    private readonly automationsService: AutomationsService
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
    } catch {
      // best effort
    }
  }

  private async pollLoop(): Promise<void> {
    await this.reclaimStalled();
    let ticks = 0;

    while (this.isRunning) {
      try {
        if (++ticks % 600 === 0) await this.reclaimStalled();
        const processedCount = await this.processBatch(5);
        if (!this.isRunning) break;
        if (processedCount > 0) {
          await this.sleepOrWake(100);
        } else {
          await this.sleepOrWake(500);
        }
      } catch (err) {
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
      events.map((event) => this.processSingleEvent(event))
    );

    return events.length;
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
        const actionsList: any[] = Array.isArray(auto.actions) ? auto.actions : [];
        const actionResults: any[] = [];

        for (const act of actionsList) {
          const handler = getActionHandler(act.type);
          if (!handler) {
            throw new Error(`Action handler "${act.type}" is not registered`);
          }
          const result = await handler.execute(context, act.config);
          actionResults.push(result);
        }

        await this.sql`
          UPDATE automation_runs
          SET
            status = 'success',
            finished_at = now(),
            log = ${this.jsonb({ results: actionResults })}::text::jsonb
          WHERE id = ${runRecord.id}
        `;
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

    if (!hasFailure) {
      await this.sql`
        UPDATE outbox_events
        SET status = 'done', processed_at = now(), attempts = COALESCE(attempts, 0) + 1
        WHERE id = ${event.id}
      `;
    } else {
      await this.handleEventFailure(event, lastErrorMessage || 'Action execution failed');
    }
  }

  private async handleEventFailure(event: any, errorMessage: string): Promise<void> {
    const nextAttempts = (event.attempts || 0) + 1;
    const delays = process.env.NODE_ENV === 'test' || process.env.FAST_RETRY === 'true'
      ? [100, 200, 500, 1000, 2000]
      : [1_000, 10_000, 60_000, 300_000, 1_800_000];
    const delayMs = delays[nextAttempts - 1] ?? 1_800_000;
    const nextAvailableAt = new Date(Date.now() + delayMs);

    if (nextAttempts > delays.length) {
      await this.sql`
        UPDATE outbox_events
        SET
          status = 'failed',
          attempts = ${nextAttempts},
          last_error = ${errorMessage},
          processed_at = now()
        WHERE id = ${event.id}
      `;
    } else {
      await this.sql`
        UPDATE outbox_events
        SET
          status = 'pending',
          attempts = ${nextAttempts},
          available_at = ${nextAvailableAt.toISOString()},
          last_error = ${errorMessage}
        WHERE id = ${event.id}
      `;
    }
  }
}
