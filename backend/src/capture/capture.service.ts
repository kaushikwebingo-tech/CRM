import { Injectable, Inject } from '@nestjs/common';
import * as crypto from 'crypto';
import postgres from 'postgres';
import Redis from 'ioredis';
import { PG_CLIENT } from '../db/connection';
import { REDIS } from '../auth/session.service';
import { ModulesService } from '../metadata/modules.service';
import { SchemaCompiler } from '../metadata/schema-compiler';
import { DedupService } from './dedup.service';
import { AssignmentService } from './assignment.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RoutingService } from '../routing/routing.service';
import { SlaService } from '../routing/sla.service';
import {
  CreateLeadSourceDto,
  UpdateLeadSourceDto,
  PublicFormDefinition,
  FormSubmissionResult,
  QuarantineItem,
} from './capture.types';
import { NotFoundError, ValidationError } from '../common/errors';

@Injectable()
export class CaptureService {
  constructor(
    @Inject(PG_CLIENT) private readonly sql: postgres.Sql,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly modulesService: ModulesService,
    private readonly schemaCompiler: SchemaCompiler,
    private readonly dedupService: DedupService,
    private readonly assignmentService: AssignmentService,
    private readonly notificationsService: NotificationsService,
    private readonly routingService: RoutingService,
    private readonly slaService: SlaService,
  ) {}

  private jsonb(value: unknown): string {
    return JSON.stringify(value ?? {});
  }

  async listSources(orgId: string): Promise<any[]> {
    return this.sql<any[]>`
      SELECT *
      FROM lead_sources
      WHERE org_id = ${orgId}
        AND deleted_at IS NULL
      ORDER BY created_at DESC
    `;
  }

  async getSource(orgId: string, id: string): Promise<any> {
    const [row] = await this.sql<any[]>`
      SELECT *
      FROM lead_sources
      WHERE id = ${id}
        AND org_id = ${orgId}
        AND deleted_at IS NULL
    `;
    if (!row) {
      throw new NotFoundError(`Lead source ${id} not found`);
    }
    return row;
  }

  async createSource(orgId: string, dto: CreateLeadSourceDto): Promise<any> {
    const targetModuleKey = dto.targetModuleKey || 'lead';
    const mod = await this.modulesService.getByKey(orgId, targetModuleKey);
    if (!mod) {
      throw new ValidationError(`Target module "${targetModuleKey}" not found`);
    }

    const secret = crypto.randomBytes(24).toString('hex');

    const [created] = await this.sql<any[]>`
      INSERT INTO lead_sources (
        org_id,
        name,
        type,
        target_module_key,
        field_mapping,
        defaults,
        dedupe_on,
        on_duplicate,
        assign_to,
        config,
        secret
      ) VALUES (
        ${orgId},
        ${dto.name},
        ${dto.type || 'web_form'},
        ${targetModuleKey},
        ${this.jsonb(dto.fieldMapping || {})}::text::jsonb,
        ${this.jsonb(dto.defaults || {})}::text::jsonb,
        ${this.jsonb(dto.dedupeOn || ['email'])}::text::jsonb,
        ${dto.onDuplicate || 'update_existing'},
        ${this.jsonb(dto.assignTo || {})}::text::jsonb,
        ${this.jsonb(dto.config || {})}::text::jsonb,
        ${secret}
      )
      RETURNING *
    `;

    return created;
  }

  async updateSource(orgId: string, id: string, dto: UpdateLeadSourceDto): Promise<any> {
    await this.getSource(orgId, id);

    const [updated] = await this.sql<any[]>`
      UPDATE lead_sources
      SET
        name = COALESCE(${dto.name ?? null}, name),
        field_mapping = COALESCE(${dto.fieldMapping ? this.jsonb(dto.fieldMapping) : null}::text::jsonb, field_mapping),
        defaults = COALESCE(${dto.defaults ? this.jsonb(dto.defaults) : null}::text::jsonb, defaults),
        dedupe_on = COALESCE(${dto.dedupeOn ? this.jsonb(dto.dedupeOn) : null}::text::jsonb, dedupe_on),
        on_duplicate = COALESCE(${dto.onDuplicate ?? null}, on_duplicate),
        assign_to = COALESCE(${dto.assignTo ? this.jsonb(dto.assignTo) : null}::text::jsonb, assign_to),
        config = COALESCE(${dto.config ? this.jsonb(dto.config) : null}::text::jsonb, config),
        is_active = COALESCE(${dto.isActive ?? null}, is_active),
        updated_at = now()
      WHERE id = ${id}
        AND org_id = ${orgId}
      RETURNING *
    `;

    return updated;
  }

  async deleteSource(orgId: string, id: string): Promise<void> {
    await this.getSource(orgId, id);
    await this.sql`
      UPDATE lead_sources
      SET deleted_at = now()
      WHERE id = ${id}
        AND org_id = ${orgId}
    `;
  }

  async getPublicFormDefinition(sourceId: string): Promise<PublicFormDefinition> {
    const [source] = await this.sql<any[]>`
      SELECT *
      FROM lead_sources
      WHERE id = ${sourceId}
        AND is_active = true
        AND deleted_at IS NULL
    `;

    if (!source) {
      throw new NotFoundError(`Form ${sourceId} not found or inactive`);
    }

    const mod = await this.modulesService.getByKey(source.org_id, source.target_module_key);
    if (!mod) {
      throw new NotFoundError(`Module ${source.target_module_key} not found`);
    }

    const compiled = await this.schemaCompiler.compile(mod.id);
    const config = source.config || {};
    const allowedKeys: string[] = Array.isArray(config.fields) && config.fields.length > 0
      ? config.fields
      : compiled.fields.filter((f) => !f.isSystem).map((f) => f.key);

    const formFields = allowedKeys
      .map((k) => compiled.fieldsByKey.get(k))
      .filter((f): f is NonNullable<typeof f> => !!f)
      .map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        isRequired: f.isRequired,
        helpText: f.helpText,
        config: (f.config as Record<string, unknown>) || {},
      }));

    return {
      sourceId: source.id,
      name: source.name,
      title: config.title || source.name,
      description: config.description || '',
      submitButtonText: config.submitButtonText || 'Submit',
      successMessage: config.successMessage || 'Thank you! Your information has been received.',
      redirectUrl: config.redirectUrl,
      theme: config.theme,
      fields: formFields,
    };
  }

  async processSubmission(
    sourceId: string,
    rawPayload: Record<string, unknown>,
    ipAddress?: string,
  ): Promise<FormSubmissionResult> {
    const [source] = await this.sql<any[]>`
      SELECT *
      FROM lead_sources
      WHERE id = ${sourceId}
        AND is_active = true
        AND deleted_at IS NULL
    `;

    if (!source) {
      throw new NotFoundError(`Lead source ${sourceId} not found or inactive`);
    }

    const orgId = source.org_id;

    if (rawPayload['_hp'] || rawPayload['website_hp']) {
      return {
        success: true,
        message: 'Submission received',
      };
    }

    if (ipAddress) {
      const rateLimitKey = `ratelimit:form:${sourceId}:${ipAddress}`;
      try {
        const attempts = await this.redis.incr(rateLimitKey);
        if (attempts === 1) {
          await this.redis.expire(rateLimitKey, 60);
        }
        const maxPerMin = source.config?.rateLimitPerMinute || 30;
        if (attempts > maxPerMin) {
          throw new ValidationError('Too many submissions from this IP address. Please try again shortly.');
        }
      } catch (err: any) {
        if (err instanceof ValidationError) throw err;
      }
    }

    const mod = await this.modulesService.getByKey(orgId, source.target_module_key);
    if (!mod) {
      throw new NotFoundError(`Module ${source.target_module_key} not found`);
    }

    const compiled = await this.schemaCompiler.compile(mod.id);

    const mapping = (source.field_mapping as Record<string, string>) || {};
    const mappedData: Record<string, unknown> = {
      ...(source.defaults || {}),
    };

    for (const [rawKey, rawVal] of Object.entries(rawPayload)) {
      if (rawKey.startsWith('_')) continue;
      const targetFieldKey = mapping[rawKey] || rawKey;
      mappedData[targetFieldKey] = rawVal;
    }

    let displayName = String(
      mappedData['display_name'] ||
      mappedData['name'] ||
      mappedData['fullName'] ||
      mappedData['full_name'] ||
      mappedData['company'] ||
      mappedData['email'] ||
      mappedData['phone'] ||
      'Inbound Lead',
    ).trim();

    const missingRequired: string[] = [];
    for (const field of compiled.fields) {
      if (field.isRequired && !field.isSystem) {
        const val = mappedData[field.key];
        if (val == null || val === '') {
          missingRequired.push(field.key);
        }
      }
    }

    if (missingRequired.length > 0) {
      const [qRow] = await this.sql<any[]>`
        INSERT INTO quarantine (
          org_id,
          source_id,
          source_type,
          raw_payload,
          error_reason,
          error_details,
          status
        ) VALUES (
          ${orgId},
          ${source.id},
          ${source.type},
          ${this.jsonb(rawPayload)}::text::jsonb,
          ${`Missing required field(s): ${missingRequired.join(', ')}`},
          ${this.jsonb({ missingFields: missingRequired, mappedData })}::text::jsonb,
          'quarantined'
        )
        RETURNING id
      `;

      return {
        success: false,
        quarantined: true,
        quarantineId: qRow.id,
        message: `Submission parked in quarantine: missing required fields (${missingRequired.join(', ')})`,
        errors: missingRequired.map((f) => ({ field: f, message: 'Field is required' })),
      };
    }

    const dedupeOn = (source.dedupe_on as string[]) || ['email'];
    const dedupResult = await this.dedupService.checkDuplicate(orgId, mod.id, dedupeOn, mappedData);

    let targetRecordId: string | null = null;
    let isDuplicate = false;

    if (dedupResult.isDuplicate && dedupResult.matchedRecordId) {
      isDuplicate = true;
      targetRecordId = dedupResult.matchedRecordId;

      if (source.on_duplicate === 'reject') {
        return {
          success: false,
          isDuplicate: true,
          recordId: targetRecordId,
          message: `Duplicate submission rejected (matched on ${dedupResult.matchedField})`,
        };
      }

      if (source.on_duplicate === 'update_existing' || source.on_duplicate === 'merge') {
        const [existing] = await this.sql<any[]>`
          SELECT id, data, display_name
          FROM records
          WHERE id = ${targetRecordId}
            AND org_id = ${orgId}
        `;

        const existingData = existing?.data || {};
        const nextData = source.on_duplicate === 'merge'
          ? { ...mappedData, ...existingData }
          : { ...existingData, ...mappedData };

        await this.sql`
          UPDATE records
          SET
            data = ${this.jsonb(nextData)}::text::jsonb,
            updated_at = now()
          WHERE id = ${targetRecordId}
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
            ${targetRecordId},
            ${mod.id},
            'inbound.received',
            'system',
            ${this.jsonb({
              sourceId: source.id,
              sourceName: source.name,
              isDuplicate: true,
              dedupeField: dedupResult.matchedField,
            })}::text::jsonb
          )
        `;

        return {
          success: true,
          isDuplicate: true,
          recordId: targetRecordId,
          message: source.config?.successMessage || 'Submission updated existing record successfully',
        };
      }
    }

    const routedAssignment = await this.routingService.evaluateAssignment(
      orgId,
      mod.id,
      mappedData,
      null,
    );

    const assignedOwnerId = routedAssignment.ownerId || await this.assignmentService.resolveOwner(
      orgId,
      source.id,
      source.assign_to || {},
      mappedData,
    );

    const [defaultPipeline] = await this.sql<any[]>`
      SELECT id
      FROM pipelines
      WHERE org_id = ${orgId}
        AND module_id = ${mod.id}
        AND deleted_at IS NULL
      ORDER BY is_default DESC, position ASC
      LIMIT 1
    `;

    let defaultStageId: string | null = null;
    if (defaultPipeline) {
      const [firstStage] = await this.sql<any[]>`
        SELECT id
        FROM pipeline_stages
        WHERE pipeline_id = ${defaultPipeline.id}
          AND org_id = ${orgId}
          AND deleted_at IS NULL
        ORDER BY position ASC
        LIMIT 1
      `;
      defaultStageId = firstStage?.id || null;
    }

    const [inserted] = await this.sql<any[]>`
      INSERT INTO records (
        org_id,
        module_id,
        display_name,
        owner_id,
        pipeline_id,
        stage_id,
        stage_since,
        data
      ) VALUES (
        ${orgId},
        ${mod.id},
        ${displayName},
        ${assignedOwnerId},
        ${defaultPipeline?.id || null},
        ${defaultStageId},
        ${defaultStageId ? new Date().toISOString() : null},
        ${this.jsonb(mappedData)}::text::jsonb
      )
      RETURNING *
    `;

    targetRecordId = inserted.id;

    await this.slaService.attachSlaToRecord(orgId, mod.id, inserted);

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
        ${targetRecordId},
        ${mod.id},
        'record.created',
        'system',
        ${this.jsonb({
          sourceId: source.id,
          sourceName: source.name,
          sourceType: source.type,
          ownerId: assignedOwnerId,
        })}::text::jsonb
      )
    `;

    await this.sql`
      INSERT INTO outbox_events (
        org_id,
        event_type,
        aggregate_id,
        payload,
        available_at
      ) VALUES (
        ${orgId},
        'record.created',
        ${targetRecordId},
        ${this.jsonb({
          moduleKey: source.target_module_key,
          recordId: targetRecordId,
          displayName,
          ownerId: assignedOwnerId,
          data: mappedData,
          sourceId: source.id,
        })}::text::jsonb,
        now()
      )
    `;

    if (assignedOwnerId) {
      await this.notificationsService.notifyOwner(
        orgId,
        assignedOwnerId,
        'lead_assigned',
        `New Lead Assigned: ${displayName}`,
        `A new lead was captured from ${source.name} and assigned to you.`,
        {
          recordId: targetRecordId,
          moduleKey: source.target_module_key,
          sourceId: source.id,
          phone: mappedData['phone'],
          email: mappedData['email'],
        },
      );
    }

    return {
      success: true,
      recordId: targetRecordId || undefined,
      assignedOwnerId: assignedOwnerId || undefined,
      isDuplicate: false,
      message: source.config?.successMessage || 'Form submitted successfully',
    };
  }

  async listQuarantine(orgId: string, status?: string): Promise<QuarantineItem[]> {
    const rows = status
      ? await this.sql<any[]>`
          SELECT *
          FROM quarantine
          WHERE org_id = ${orgId}
            AND status = ${status}
          ORDER BY created_at DESC
          LIMIT 100
        `
      : await this.sql<any[]>`
          SELECT *
          FROM quarantine
          WHERE org_id = ${orgId}
          ORDER BY created_at DESC
          LIMIT 100
        `;

    return rows.map((r) => ({
      id: r.id,
      orgId: r.org_id,
      sourceId: r.source_id,
      sourceType: r.source_type,
      rawPayload: r.raw_payload || {},
      errorReason: r.error_reason,
      errorDetails: r.error_details || {},
      status: r.status,
      replayedRecordId: r.replayed_record_id,
      createdAt: new Date(r.created_at).toISOString(),
      replayedAt: r.replayed_at ? new Date(r.replayed_at).toISOString() : null,
    }));
  }

  async replayQuarantine(
    orgId: string,
    quarantineId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<FormSubmissionResult> {
    const [qRow] = await this.sql<any[]>`
      SELECT *
      FROM quarantine
      WHERE id = ${quarantineId}
        AND org_id = ${orgId}
    `;

    if (!qRow) {
      throw new NotFoundError(`Quarantined record ${quarantineId} not found`);
    }

    const payload = {
      ...(qRow.raw_payload || {}),
      ...overrides,
    };

    const result = await this.processSubmission(qRow.source_id, payload);

    if (result.success && result.recordId) {
      await this.sql`
        UPDATE quarantine
        SET
          status = 'replayed',
          replayed_record_id = ${result.recordId},
          replayed_at = now()
        WHERE id = ${quarantineId}
          AND org_id = ${orgId}
      `;
    }

    return result;
  }

  async discardQuarantine(orgId: string, quarantineId: string): Promise<void> {
    const [row] = await this.sql<any[]>`
      UPDATE quarantine
      SET status = 'discarded'
      WHERE id = ${quarantineId}
        AND org_id = ${orgId}
      RETURNING id
    `;

    if (!row) {
      throw new NotFoundError(`Quarantined record ${quarantineId} not found`);
    }
  }
}
