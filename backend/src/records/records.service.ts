import { Injectable, Inject } from '@nestjs/common';
import postgres from 'postgres';
import { PG_CLIENT } from '../db/connection';
import { SchemaCompiler, CompiledModule, CompiledField } from '../metadata/schema-compiler';
import { ModulesService } from '../metadata/modules.service';
import { getFieldType } from '../field-types/registry';
import { parseCsv, stringifyCsv } from '../common/csv';
import { FilterCompiler } from './filter-compiler';
import { SearchCompiler } from './search-compiler';
import { encodeCursor, decodeCursor } from './keyset-pagination';
import { NotFoundError, ValidationError, ForbiddenError } from '../common/errors';

export interface RecordListQuery {
  view?: string;
  filter?: string;
  sort?: string;
  cursor?: string;
  limit?: number;
  q?: string;
  fields?: string;
}

export interface CurrentUserPayload {
  id: string;
  orgId: string;
  email: string;
  fullName: string;
  role: {
    id: string;
    name: string;
    permissions: Record<string, unknown>;
  };
}

@Injectable()
export class RecordsService {
  constructor(
    @Inject(PG_CLIENT) private readonly sql: postgres.Sql,
    private readonly schemaCompiler: SchemaCompiler,
    private readonly modulesService: ModulesService
  ) {}

  async create(
    orgId: string,
    moduleKey: string,
    body: { display_name: string; owner_id?: string; stage_id?: string; pipeline_id?: string; data?: Record<string, unknown> },
    currentUser: CurrentUserPayload,
    idempotencyKey?: string
  ) {
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const compiled = await this.schemaCompiler.compile(mod.id);

    if (!body.display_name || typeof body.display_name !== 'string' || !body.display_name.trim()) {
      throw new ValidationError('display_name is required', [
        { field: 'display_name', message: 'Display name cannot be empty' },
      ]);
    }

    const dataInput = body.data || {};
    const normalizedData: Record<string, unknown> = {};

    for (const field of compiled.fields) {
      const def = getFieldType(field.type);
      const rawVal = dataInput[field.key] !== undefined ? dataInput[field.key] : compiled.defaults[field.key];
      const val = def.normalize(rawVal, field.config as never);

      if (field.isRequired && (val === null || val === undefined)) {
        throw new ValidationError(`Field "${field.label}" is required`, [
          { field: field.key, message: `Field "${field.label}" is required` },
        ]);
      }

      if (val !== null && val !== undefined) {
        normalizedData[field.key] = val;
      }
    }

    const searchTexts: string[] = [body.display_name.trim()];
    for (const key of compiled.searchableKeys) {
      const field = compiled.fieldsByKey.get(key);
      if (field && normalizedData[key] !== undefined) {
        const def = getFieldType(field.type);
        const st = def.toSearchText(normalizedData[key] as never, field.config as never);
        if (st) searchTexts.push(st);
      }
    }
    const searchTsv = searchTexts.join(' ');

    const [record] = await this.sql.begin(async (tx) => {
      const [insertedRecord] = await tx`
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
          ${orgId},
          ${mod.id},
          ${body.display_name.trim()},
          ${body.owner_id || null},
          ${body.pipeline_id || null},
          ${body.stage_id || null},
          ${body.stage_id ? new Date().toISOString() : null},
          ${JSON.stringify(normalizedData)}::jsonb,
          ${searchTsv},
          ${currentUser.id},
          ${currentUser.id}
        )
        RETURNING *
      `;

      for (const field of compiled.fields) {
        if (field.type === 'lookup' && normalizedData[field.key]) {
          await tx`
            INSERT INTO record_links (
              org_id,
              source_record_id,
              source_field_key,
              target_record_id
            ) VALUES (
              ${orgId},
              ${insertedRecord.id},
              ${field.key},
              ${normalizedData[field.key] as string}
            )
            ON CONFLICT DO NOTHING
          `;
        }
      }

      await tx`
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
          ${orgId},
          ${insertedRecord.id},
          ${mod.id},
          'created',
          ${currentUser.id},
          'user',
          ${JSON.stringify({})},
          ${JSON.stringify({ display_name: insertedRecord.display_name, data: normalizedData })}
        )
      `;

      await tx`
        INSERT INTO outbox_events (
          org_id,
          event_type,
          aggregate_id,
          payload,
          available_at
        ) VALUES (
          ${orgId},
          'record.created',
          ${insertedRecord.id},
          ${JSON.stringify({
            moduleKey,
            recordId: insertedRecord.id,
            displayName: insertedRecord.display_name,
            actorId: currentUser.id,
            idempotencyKey,
          })},
          now()
        )
      `;

      return [insertedRecord];
    });

    return this.expandLookups(orgId, compiled, [record]).then((res) => res[0]);
  }

  async findById(orgId: string, moduleKey: string, recordId: string) {
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const compiled = await this.schemaCompiler.compile(mod.id);

    const [record] = await this.sql`
      SELECT *
      FROM records
      WHERE org_id = ${orgId}
        AND module_id = ${mod.id}
        AND id = ${recordId}
        AND deleted_at IS NULL
      LIMIT 1
    `;

    if (!record) {
      throw new NotFoundError(`Record ${recordId} not found`);
    }

    const expanded = await this.expandLookups(orgId, compiled, [record]);
    return expanded[0];
  }

  async update(
    orgId: string,
    moduleKey: string,
    recordId: string,
    body: { display_name?: string; owner_id?: string; stage_id?: string; pipeline_id?: string; data?: Record<string, unknown> },
    currentUser: CurrentUserPayload,
    idempotencyKey?: string
  ) {
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const compiled = await this.schemaCompiler.compile(mod.id);

    const [existing] = await this.sql`
      SELECT *
      FROM records
      WHERE org_id = ${orgId}
        AND module_id = ${mod.id}
        AND id = ${recordId}
        AND deleted_at IS NULL
      LIMIT 1
    `;

    if (!existing) {
      throw new NotFoundError(`Record ${recordId} not found`);
    }

    const currentData = (existing.data as Record<string, unknown>) || {};
    const updatedData = { ...currentData };
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    if (body.display_name !== undefined && body.display_name !== existing.display_name) {
      if (!body.display_name.trim()) {
        throw new ValidationError('display_name cannot be empty');
      }
      changes.display_name = { from: existing.display_name, to: body.display_name.trim() };
    }

    if (body.owner_id !== undefined && body.owner_id !== existing.owner_id) {
      changes.owner_id = { from: existing.owner_id, to: body.owner_id };
    }

    if (body.stage_id !== undefined && body.stage_id !== existing.stage_id) {
      changes.stage_id = { from: existing.stage_id, to: body.stage_id };
    }

    if (body.data) {
      for (const [key, rawVal] of Object.entries(body.data)) {
        const field = compiled.fieldsByKey.get(key);
        if (!field) continue;

        const def = getFieldType(field.type);
        const val = def.normalize(rawVal, field.config as never);
        const oldVal = currentData[key];

        if (JSON.stringify(oldVal) !== JSON.stringify(val)) {
          changes[key] = { from: oldVal, to: val };
          if (val === null || val === undefined) {
            delete updatedData[key];
          } else {
            updatedData[key] = val;
          }
        }
      }
    }

    const newDisplayName = body.display_name !== undefined ? body.display_name.trim() : existing.display_name;
    const newOwnerId = body.owner_id !== undefined ? body.owner_id : existing.owner_id;
    const newStageId = body.stage_id !== undefined ? body.stage_id : existing.stage_id;
    const newPipelineId = body.pipeline_id !== undefined ? body.pipeline_id : existing.pipeline_id;

    const searchTexts: string[] = [newDisplayName];
    for (const key of compiled.searchableKeys) {
      const field = compiled.fieldsByKey.get(key);
      if (field && updatedData[key] !== undefined) {
        const def = getFieldType(field.type);
        const st = def.toSearchText(updatedData[key] as never, field.config as never);
        if (st) searchTexts.push(st);
      }
    }
    const searchTsv = searchTexts.join(' ');

    const [updated] = await this.sql.begin(async (tx) => {
      const [rec] = await tx`
        UPDATE records
        SET
          display_name = ${newDisplayName},
          owner_id = ${newOwnerId},
          stage_id = ${newStageId},
          pipeline_id = ${newPipelineId},
          stage_since = ${changes.stage_id ? new Date().toISOString() : existing.stage_since},
          data = ${JSON.stringify(updatedData)}::jsonb,
          search_tsv = ${searchTsv},
          updated_by = ${currentUser.id},
          updated_at = now()
        WHERE id = ${recordId}
        RETURNING *
      `;

      if (Object.keys(changes).length > 0) {
        await tx`
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
            ${orgId},
            ${recordId},
            ${mod.id},
            'updated',
            ${currentUser.id},
            'user',
            ${JSON.stringify(changes)},
            ${JSON.stringify({ updated_keys: Object.keys(changes) })}
          )
        `;

        await tx`
          INSERT INTO outbox_events (
            org_id,
            event_type,
            aggregate_id,
            payload,
            available_at
          ) VALUES (
            ${orgId},
            'record.updated',
            ${recordId},
            ${JSON.stringify({
              moduleKey,
              recordId,
              changes,
              actorId: currentUser.id,
              idempotencyKey,
            })},
            now()
          )
        `;
      }

      return [rec];
    });

    const res = await this.expandLookups(orgId, compiled, [updated]);
    return res[0];
  }

  async changeStage(
    orgId: string,
    moduleKey: string,
    recordId: string,
    stageId: string,
    currentUser: CurrentUserPayload
  ) {
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const compiled = await this.schemaCompiler.compile(mod.id);

    const [existing] = await this.sql`
      SELECT *
      FROM records
      WHERE org_id = ${orgId}
        AND module_id = ${mod.id}
        AND id = ${recordId}
        AND deleted_at IS NULL
      LIMIT 1
    `;

    if (!existing) {
      throw new NotFoundError(`Record ${recordId} not found`);
    }

    if (existing.stage_id === stageId) {
      const res = await this.expandLookups(orgId, compiled, [existing]);
      return res[0];
    }

    const [targetStage] = await this.sql`
      SELECT ps.id, ps.label, ps.pipeline_id
      FROM pipeline_stages ps
      JOIN pipelines p ON p.id = ps.pipeline_id
      WHERE ps.id = ${stageId}
        AND ps.org_id = ${orgId}
        AND p.module_id = ${mod.id}
        AND ps.deleted_at IS NULL
        AND p.deleted_at IS NULL
      LIMIT 1
    `;

    if (!targetStage) {
      throw new ValidationError(`Invalid stage: stage does not belong to module ${moduleKey}`);
    }

    const [updated] = await this.sql.begin(async (tx) => {
      const [rec] = await tx`
        UPDATE records
        SET
          stage_id = ${stageId},
          pipeline_id = ${targetStage.pipeline_id},
          stage_since = now(),
          updated_by = ${currentUser.id},
          updated_at = now()
        WHERE id = ${recordId}
        RETURNING *
      `;

      await tx`
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
          ${orgId},
          ${recordId},
          ${mod.id},
          'stage_changed',
          ${currentUser.id},
          'user',
          ${JSON.stringify({
            stage_id: { from: existing.stage_id, to: stageId },
          })},
          ${JSON.stringify({
            from_stage_id: existing.stage_id,
            to_stage_id: stageId,
            to_stage_label: targetStage.label,
          })}
        )
      `;

      await tx`
        INSERT INTO outbox_events (
          org_id,
          event_type,
          aggregate_id,
          payload,
          available_at
        ) VALUES (
          ${orgId},
          'record.stage_changed',
          ${recordId},
          ${JSON.stringify({
            moduleKey,
            recordId,
            fromStageId: existing.stage_id,
            toStageId: stageId,
            actorId: currentUser.id,
          })},
          now()
        )
      `;

      return [rec];
    });

    const res = await this.expandLookups(orgId, compiled, [updated]);
    return res[0];
  }

  async getTimeline(orgId: string, moduleKey: string, recordId: string) {
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const events = await this.sql`
      SELECT
        re.id,
        re.record_id,
        re.module_id,
        re.type,
        re.actor_id,
        re.actor_type,
        re.changes,
        re.payload,
        re.created_at,
        u.full_name as actor_name,
        u.email as actor_email,
        u.avatar_url as actor_avatar
      FROM record_events re
      LEFT JOIN users u ON u.id = re.actor_id
      WHERE re.org_id = ${orgId}
        AND re.record_id = ${recordId}
      ORDER BY re.created_at DESC
      LIMIT 100
    `;
    return events;
  }

  async delete(orgId: string, moduleKey: string, recordId: string, currentUser: CurrentUserPayload) {
    const mod = await this.modulesService.getByKey(orgId, moduleKey);

    const [existing] = await this.sql`
      SELECT id, display_name
      FROM records
      WHERE org_id = ${orgId}
        AND module_id = ${mod.id}
        AND id = ${recordId}
        AND deleted_at IS NULL
      LIMIT 1
    `;

    if (!existing) {
      throw new NotFoundError(`Record ${recordId} not found`);
    }

    await this.sql.begin(async (tx) => {
      await tx`
        UPDATE records
        SET deleted_at = now(), updated_by = ${currentUser.id}
        WHERE id = ${recordId}
      `;

      await tx`
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
          ${recordId},
          ${mod.id},
          'deleted',
          ${currentUser.id},
          'user',
          ${JSON.stringify({ display_name: existing.display_name })}
        )
      `;

      await tx`
        INSERT INTO outbox_events (
          org_id,
          event_type,
          aggregate_id,
          payload,
          available_at
        ) VALUES (
          ${orgId},
          'record.deleted',
          ${recordId},
          ${JSON.stringify({
            moduleKey,
            recordId,
            actorId: currentUser.id,
          })},
          now()
        )
      `;
    });

    return { success: true };
  }

  async bulkAction(
    orgId: string,
    moduleKey: string,
    payload: {
      action: 'assign' | 'update' | 'delete';
      record_ids: string[];
      data?: Record<string, any>;
    },
    currentUser: CurrentUserPayload
  ) {
    const { action, record_ids, data = {} } = payload;
    if (!Array.isArray(record_ids) || record_ids.length === 0) {
      throw new ValidationError('record_ids must be a non-empty array');
    }
    if (record_ids.length > 1000) {
      throw new ValidationError('Cannot perform bulk action on more than 1000 records at once');
    }

    const mod = await this.modulesService.getByKey(orgId, moduleKey);

    return await this.sql.begin(async (tx) => {
      if (action === 'assign') {
        const ownerId = data.owner_id || null;
        if (ownerId) {
          const [userExists] = await tx`
            SELECT id FROM users WHERE id = ${ownerId} AND org_id = ${orgId} AND is_active = true LIMIT 1
          `;
          if (!userExists) {
            throw new ValidationError('Assigned user not found or inactive');
          }
        }

        const updated = await tx`
          UPDATE records
          SET owner_id = ${ownerId || null}::uuid, updated_by = ${currentUser.id}, updated_at = now()
          WHERE org_id = ${orgId}
            AND module_id = ${mod.id}
            AND id = ANY(${record_ids})
            AND deleted_at IS NULL
          RETURNING id, display_name
        `;

        for (const r of updated) {
          await tx`
            INSERT INTO record_events (
              org_id, record_id, module_id, type, actor_id, actor_type, changes, payload
            ) VALUES (
              ${orgId}, ${r.id}, ${mod.id}, 'updated', ${currentUser.id}, 'user',
              ${JSON.stringify({ owner_id: { to: ownerId } })},
              ${JSON.stringify({ bulk_action: 'assign' })}
            )
          `;
        }

        await tx`
          INSERT INTO outbox_events (
            org_id, event_type, aggregate_id, payload, available_at
          ) VALUES (
            ${orgId}, 'record.bulk_assigned', ${mod.id},
            ${JSON.stringify({ moduleKey, record_ids: updated.map((r: any) => r.id), ownerId, actorId: currentUser.id })},
            now()
          )
        `;

        return { success: true, count: updated.length };
      }

      if (action === 'delete') {
        const deleted = await tx`
          UPDATE records
          SET deleted_at = now(), updated_by = ${currentUser.id}
          WHERE org_id = ${orgId}
            AND module_id = ${mod.id}
            AND id = ANY(${record_ids})
            AND deleted_at IS NULL
          RETURNING id, display_name
        `;

        for (const r of deleted) {
          await tx`
            INSERT INTO record_events (
              org_id, record_id, module_id, type, actor_id, actor_type, payload
            ) VALUES (
              ${orgId}, ${r.id}, ${mod.id}, 'deleted', ${currentUser.id}, 'user',
              ${JSON.stringify({ display_name: r.display_name, bulk_action: 'delete' })}
            )
          `;
        }

        await tx`
          INSERT INTO outbox_events (
            org_id, event_type, aggregate_id, payload, available_at
          ) VALUES (
            ${orgId}, 'record.bulk_deleted', ${mod.id},
            ${JSON.stringify({ moduleKey, record_ids: deleted.map((r: any) => r.id), actorId: currentUser.id })},
            now()
          )
        `;

        return { success: true, count: deleted.length };
      }

      if (action === 'update') {
        let stageId = data.stage_id;
        let pipelineId = null;
        if (stageId) {
          const [stg] = await tx`
            SELECT id, pipeline_id FROM pipeline_stages WHERE id = ${stageId} AND org_id = ${orgId} AND deleted_at IS NULL LIMIT 1
          `;
          if (!stg) throw new ValidationError('Stage not found');
          pipelineId = stg.pipeline_id;
        }

        const dynamicMerge = data.data ? JSON.stringify(data.data) : null;

        const updated = await tx`
          UPDATE records
          SET
            stage_id = COALESCE(${stageId || null}::uuid, stage_id),
            pipeline_id = COALESCE(${pipelineId || null}::uuid, pipeline_id),
            stage_since = CASE WHEN ${stageId || null}::uuid IS NOT NULL THEN now() ELSE stage_since END,
            data = CASE WHEN ${dynamicMerge || null}::jsonb IS NOT NULL THEN data || ${dynamicMerge || null}::jsonb ELSE data END,
            updated_by = ${currentUser.id},
            updated_at = now()
          WHERE org_id = ${orgId}
            AND module_id = ${mod.id}
            AND id = ANY(${record_ids})
            AND deleted_at IS NULL
          RETURNING id, display_name
        `;

        for (const r of updated) {
          await tx`
            INSERT INTO record_events (
              org_id, record_id, module_id, type, actor_id, actor_type, payload
            ) VALUES (
              ${orgId}, ${r.id}, ${mod.id}, 'updated', ${currentUser.id}, 'user',
              ${JSON.stringify({ bulk_action: 'update', data })}
            )
          `;
        }

        return { success: true, count: updated.length };
      }

      throw new ValidationError(`Unknown bulk action: ${action}`);
    });
  }

  async exportCsv(
    orgId: string,
    moduleKey: string,
    query: RecordListQuery,
    currentUser: CurrentUserPayload
  ): Promise<string> {
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const compiled = await this.schemaCompiler.compile(mod.id);

    const fullListQuery = { ...query, limit: 10000 };
    const { records: listRecords } = await this.list(orgId, moduleKey, fullListQuery, currentUser);

    const exportFields = compiled.fields.filter((f) => !f.isSystem || f.key === 'display_name' || f.key === 'created_at');
    const headers = [mod.nameFieldLabel || 'Name', ...exportFields.filter(f => f.key !== 'display_name').map((f) => f.label)];

    const rows: string[][] = [headers];

    for (const r of listRecords) {
      const row: string[] = [r.display_name];
      for (const f of exportFields) {
        if (f.key === 'display_name') continue;
        let rawVal = f.key === 'created_at' ? r.createdAt : r.data?.[f.key];
        let strVal = '';
        if (rawVal !== undefined && rawVal !== null) {
          const typeDef = getFieldType(f.type);
          strVal = typeDef.toExportString(rawVal, f.config);
        }
        row.push(strVal);
      }
      rows.push(row);
    }

    return stringifyCsv(rows);
  }

  async importCsv(
    orgId: string,
    moduleKey: string,
    csvContent: string,
    mappings: Record<string, string> = {},
    currentUser: CurrentUserPayload
  ) {
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const compiled = await this.schemaCompiler.compile(mod.id);

    const parsed = parseCsv(csvContent);
    if (parsed.length < 2) {
      throw new ValidationError('CSV must contain a header row and at least one data row');
    }

    const headers = parsed[0].map((h) => h.trim());
    const dataRows = parsed.slice(1);

    const colToField = new Map<number, { key: string; isDisplayName: boolean; fieldDef?: CompiledField }>();

    for (let c = 0; c < headers.length; c++) {
      const headerName = headers[c];
      const explicitMapping = mappings[headerName] || mappings[headerName.toLowerCase()];
      if (explicitMapping) {
        if (explicitMapping === 'display_name' || explicitMapping === (mod.nameFieldLabel || 'Name')) {
          colToField.set(c, { key: 'display_name', isDisplayName: true });
        } else {
          const field = compiled.fieldsByKey.get(explicitMapping);
          if (field) {
            colToField.set(c, { key: field.key, isDisplayName: false, fieldDef: field });
          }
        }
        continue;
      }

      const lower = headerName.toLowerCase().replace(/[\s_-]+/g, '');
      const nameMatch = (mod.nameFieldLabel || 'Name').toLowerCase().replace(/[\s_-]+/g, '');

      if (lower === 'name' || lower === 'displayname' || lower === nameMatch || lower === 'leadname' || lower === 'title') {
        colToField.set(c, { key: 'display_name', isDisplayName: true });
        continue;
      }

      const matchedField = compiled.fields.find(
        (f) =>
          f.key.toLowerCase().replace(/[\s_-]+/g, '') === lower ||
          f.label.toLowerCase().replace(/[\s_-]+/g, '') === lower
      );

      if (matchedField) {
        colToField.set(c, { key: matchedField.key, isDisplayName: false, fieldDef: matchedField });
      }
    }

    const defaultPipeline = await this.sql`
      SELECT id FROM pipelines WHERE module_id = ${mod.id} AND org_id = ${orgId} AND deleted_at IS NULL ORDER BY is_default DESC, position ASC LIMIT 1
    `;
    let defaultStageId: string | null = null;
    let defaultPipelineId: string | null = null;
    if (defaultPipeline.length > 0) {
      defaultPipelineId = defaultPipeline[0].id;
      const [firstStage] = await this.sql`
        SELECT id FROM pipeline_stages WHERE pipeline_id = ${defaultPipelineId} AND org_id = ${orgId} AND deleted_at IS NULL ORDER BY position ASC LIMIT 1
      `;
      if (firstStage) defaultStageId = firstStage.id;
    }

    let importedCount = 0;
    const errors: Array<{ row: number; error: string }> = [];

    const CHUNK_SIZE = 500;
    for (let i = 0; i < dataRows.length; i += CHUNK_SIZE) {
      const chunk = dataRows.slice(i, i + CHUNK_SIZE);
      await this.sql.begin(async (tx) => {
        for (let j = 0; j < chunk.length; j++) {
          const rowIndex = i + j + 2;
          const row = chunk[j];

          let displayName = '';
          const rowData: Record<string, unknown> = {};

          for (let colIdx = 0; colIdx < row.length; colIdx++) {
            const mapping = colToField.get(colIdx);
            if (!mapping) continue;

            const rawCell = row[colIdx];
            if (mapping.isDisplayName) {
              displayName = rawCell ? rawCell.trim() : '';
            } else if (mapping.fieldDef) {
              const typeDef = getFieldType(mapping.fieldDef.type);
              const parsedVal = typeDef.parseImport(rawCell, mapping.fieldDef.config);
              if (parsedVal !== null && parsedVal !== undefined) {
                rowData[mapping.key] = parsedVal;
              }
            }
          }

          if (!displayName) {
            displayName = `Imported ${mod.labelSingular} #${rowIndex}`;
          }

          const searchTerms: string[] = [displayName];
          for (const k of compiled.searchableKeys) {
            if (rowData[k]) {
              const f = compiled.fieldsByKey.get(k);
              if (f) {
                const td = getFieldType(f.type);
                searchTerms.push(td.toSearchText(rowData[k], f.config));
              }
            }
          }
          const searchTsv = searchTerms.filter(Boolean).join(' ');

          const [inserted] = await tx`
            INSERT INTO records (
              org_id,
              module_id,
              display_name,
              pipeline_id,
              stage_id,
              stage_since,
              data,
              search_tsv,
              created_by,
              updated_by
            ) VALUES (
              ${orgId},
              ${mod.id},
              ${displayName},
              ${defaultPipelineId},
              ${defaultStageId},
              ${defaultStageId ? new Date().toISOString() : null},
              ${JSON.stringify(rowData)}::jsonb,
              ${searchTsv},
              ${currentUser.id},
              ${currentUser.id}
            )
            RETURNING id
          `;

          await tx`
            INSERT INTO record_events (
              org_id, record_id, module_id, type, actor_id, actor_type, payload
            ) VALUES (
              ${orgId}, ${inserted.id}, ${mod.id}, 'imported', ${currentUser.id}, 'user',
              ${JSON.stringify({ row: rowIndex })}
            )
          `;

          importedCount++;
        }

        await tx`
          INSERT INTO outbox_events (
            org_id, event_type, aggregate_id, payload, available_at
          ) VALUES (
            ${orgId}, 'record.bulk_imported', ${mod.id},
            ${JSON.stringify({ moduleKey, count: chunk.length, actorId: currentUser.id })},
            now()
          )
        `;
      });
    }

    return {
      totalRows: dataRows.length,
      importedCount,
      failedCount: errors.length,
      errors,
    };
  }

  async list(
    orgId: string,
    moduleKey: string,
    query: RecordListQuery,
    currentUser: CurrentUserPayload
  ) {
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const compiled = await this.schemaCompiler.compile(mod.id);

    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const params: unknown[] = [orgId, mod.id];
    const whereConditions: string[] = [
      'r.org_id = $1',
      'r.module_id = $2',
      'r.deleted_at IS NULL',
    ];

    if (query.filter) {
      let parsedFilter: unknown;
      try {
        parsedFilter = typeof query.filter === 'string' ? JSON.parse(query.filter) : query.filter;
      } catch {
        throw new ValidationError('Invalid JSON in filter parameter');
      }
      const filterCompiler = new FilterCompiler(compiled, currentUser.id, params.length + 1);
      const compiledFilter = filterCompiler.compile(parsedFilter);
      whereConditions.push(compiledFilter.sql);
      params.push(...compiledFilter.params);
    }

    if (query.q) {
      const search = SearchCompiler.compile(query.q, params.length + 1);
      whereConditions.push(search.sql);
      params.push(...search.params);
    }

    const sortParam = query.sort || 'created_at:desc';
    const [sortFieldKey, sortDirection] = sortParam.split(':');
    const dir = sortDirection === 'asc' ? 'asc' : 'desc';

    let sortSql: string;
    if (sortFieldKey === 'display_name') {
      sortSql = 'r.display_name';
    } else if (sortFieldKey === 'created_at') {
      sortSql = 'r.created_at';
    } else if (sortFieldKey === 'updated_at') {
      sortSql = 'r.updated_at';
    } else if (sortFieldKey === 'stage_id') {
      sortSql = 'r.stage_id';
    } else if (sortFieldKey === 'owner_id') {
      sortSql = 'r.owner_id';
    } else {
      const field = compiled.fieldsByKey.get(sortFieldKey);
      if (!field || !field.isSortable) {
        throw new ValidationError(`Field "${sortFieldKey}" cannot be sorted`);
      }
      sortSql = field.sqlExpr.sql;
    }

    if (query.cursor) {
      const decoded = decodeCursor(query.cursor);
      if (decoded) {
        const cPlaceholder = `$${params.length + 1}`;
        const idPlaceholder = `$${params.length + 2}`;
        params.push(decoded.c, decoded.id);

        if (dir === 'desc') {
          whereConditions.push(`(${sortSql}, r.id) < (${cPlaceholder}, ${idPlaceholder})`);
        } else {
          whereConditions.push(`(${sortSql}, r.id) > (${cPlaceholder}, ${idPlaceholder})`);
        }
      }
    }

    const limitPlaceholder = `$${params.length + 1}`;
    params.push(limit + 1);

    const querySql = `
      SELECT r.*
      FROM records r
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY ${sortSql} ${dir}, r.id ${dir}
      LIMIT ${limitPlaceholder}
    `;

    const rows = await this.sql.unsafe(querySql, params as never[]);

    const hasMore = rows.length > limit;
    const records = hasMore ? rows.slice(0, limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore && records.length > 0) {
      const last = records[records.length - 1];
      let sortVal: unknown;
      if (sortFieldKey === 'display_name') {
        sortVal = last.display_name;
      } else if (sortFieldKey === 'created_at') {
        sortVal = last.created_at;
      } else if (sortFieldKey === 'updated_at') {
        sortVal = last.updated_at;
      } else {
        const dataObj = (last.data as Record<string, unknown>) || {};
        sortVal = dataObj[sortFieldKey] !== undefined ? dataObj[sortFieldKey] : null;
      }
      nextCursor = encodeCursor({ c: sortVal, id: last.id });
    }

    const expandedRecords = await this.expandLookups(orgId, compiled, records);

    return {
      records: expandedRecords,
      nextCursor,
      hasMore,
      schemaVersion: compiled.schemaVersion,
    };
  }

  async count(
    orgId: string,
    moduleKey: string,
    filterJson?: string,
    currentUser?: CurrentUserPayload
  ): Promise<{ count: number }> {
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const compiled = await this.schemaCompiler.compile(mod.id);

    const params: unknown[] = [orgId, mod.id];
    const whereConditions: string[] = [
      'r.org_id = $1',
      'r.module_id = $2',
      'r.deleted_at IS NULL',
    ];

    if (filterJson) {
      let parsedFilter: unknown;
      try {
        parsedFilter = typeof filterJson === 'string' ? JSON.parse(filterJson) : filterJson;
      } catch {
        throw new ValidationError('Invalid JSON in filter');
      }
      const filterCompiler = new FilterCompiler(compiled, currentUser?.id, params.length + 1);
      const compiledFilter = filterCompiler.compile(parsedFilter);
      whereConditions.push(compiledFilter.sql);
      params.push(...compiledFilter.params);
    }

    const countSql = `
      SELECT COUNT(*)::int AS count
      FROM records r
      WHERE ${whereConditions.join(' AND ')}
    `;

    const [result] = await this.sql.unsafe(countSql, params as never[]);
    return { count: result ? Number(result.count) : 0 };
  }

  private async expandLookups(
    orgId: string,
    compiled: CompiledModule,
    records: any[]
  ): Promise<any[]> {
    if (records.length === 0) return [];

    const ownerIds = new Set<string>();
    const lookupIds = new Set<string>();

    for (const r of records) {
      if (r.owner_id) ownerIds.add(r.owner_id);
      const d = (r.data as Record<string, unknown>) || {};
      for (const f of compiled.fields) {
        if (f.type === 'lookup' && d[f.key] && typeof d[f.key] === 'string') {
          lookupIds.add(d[f.key] as string);
        }
      }
    }

    const userMap = new Map<string, { id: string; fullName: string; email: string }>();
    if (ownerIds.size > 0) {
      const userRows = await this.sql`
        SELECT id, full_name, email
        FROM users
        WHERE id = ANY(${Array.from(ownerIds)})
      `;
      for (const u of userRows) {
        userMap.set(u.id, { id: u.id, fullName: u.full_name, email: u.email });
      }
    }

    const lookupMap = new Map<string, { id: string; displayName: string }>();
    if (lookupIds.size > 0) {
      const recordRows = await this.sql`
        SELECT id, display_name
        FROM records
        WHERE id = ANY(${Array.from(lookupIds)})
          AND deleted_at IS NULL
      `;
      for (const lr of recordRows) {
        lookupMap.set(lr.id, { id: lr.id, displayName: lr.display_name });
      }
    }

    return records.map((r) => {
      const expanded = { ...r };
      if (r.owner_id && userMap.has(r.owner_id)) {
        expanded.owner = userMap.get(r.owner_id);
      }
      const d = (r.data as Record<string, unknown>) || {};
      const expandedLookups: Record<string, unknown> = {};
      for (const f of compiled.fields) {
        if (f.type === 'lookup' && d[f.key] && lookupMap.has(d[f.key] as string)) {
          expandedLookups[f.key] = lookupMap.get(d[f.key] as string);
        }
      }
      if (Object.keys(expandedLookups).length > 0) {
        expanded._expanded = expandedLookups;
      }
      return expanded;
    });
  }
}
