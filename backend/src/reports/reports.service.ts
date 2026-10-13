import { Injectable, Inject } from '@nestjs/common';
import postgres from 'postgres';
import Redis from 'ioredis';
import { PG_CLIENT } from '../db/connection';
import { REDIS } from '../auth/session.service';
import { ModulesService } from '../metadata/modules.service';
import { SchemaCompiler } from '../metadata/schema-compiler';
import {
  CreateReportDto,
  UpdateReportDto,
  CreateDashboardDto,
  UpdateDashboardDto,
  FunnelReportResult,
  FunnelStageItem,
  DrillThroughItem,
} from './reports.types';
import { NotFoundError, ValidationError } from '../common/errors';

@Injectable()
export class ReportsService {
  constructor(
    @Inject(PG_CLIENT) private readonly sql: postgres.Sql,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly modulesService: ModulesService,
    private readonly schemaCompiler: SchemaCompiler,
  ) {}

  private jsonb(value: unknown): string {
    return JSON.stringify(value ?? {});
  }

  async createReport(orgId: string, dto: CreateReportDto): Promise<any> {
    if (!dto.name || !dto.name.trim()) {
      throw new ValidationError('Report name is required', [{ field: 'name', message: 'Name is required' }]);
    }
    if (!dto.moduleKey) {
      throw new ValidationError('Module key is required', [{ field: 'moduleKey', message: 'Module key is required' }]);
    }

    const [created] = await this.sql<any[]>`
      INSERT INTO reports (
        org_id,
        module_key,
        name,
        type,
        config
      ) VALUES (
        ${orgId},
        ${dto.moduleKey},
        ${dto.name.trim()},
        ${dto.type || 'funnel'},
        ${this.jsonb(dto.config || {})}
      )
      RETURNING *
    `;

    return created;
  }

  async updateReport(orgId: string, id: string, dto: UpdateReportDto): Promise<any> {
    const [existing] = await this.sql<any[]>`
      SELECT *
      FROM reports
      WHERE id = ${id}
        AND org_id = ${orgId}
    `;

    if (!existing) {
      throw new NotFoundError(`Report ${id} not found`);
    }

    const [updated] = await this.sql<any[]>`
      UPDATE reports
      SET
        name = COALESCE(${dto.name?.trim() ?? null}, name),
        type = COALESCE(${dto.type ?? null}, type),
        config = COALESCE(${dto.config ? this.jsonb(dto.config) : null}::text::jsonb, config),
        updated_at = now()
      WHERE id = ${id}
        AND org_id = ${orgId}
      RETURNING *
    `;

    return updated;
  }

  async deleteReport(orgId: string, id: string): Promise<void> {
    const [row] = await this.sql<any[]>`
      DELETE FROM reports
      WHERE id = ${id}
        AND org_id = ${orgId}
      RETURNING id
    `;

    if (!row) {
      throw new NotFoundError(`Report ${id} not found`);
    }
  }

  async getReport(orgId: string, id: string): Promise<any> {
    const [report] = await this.sql<any[]>`
      SELECT *
      FROM reports
      WHERE id = ${id}
        AND org_id = ${orgId}
    `;

    if (!report) {
      throw new NotFoundError(`Report ${id} not found`);
    }

    return report;
  }

  async listReports(orgId: string, moduleKey?: string): Promise<any[]> {
    const rows = await this.sql<any[]>`
      SELECT *
      FROM reports
      WHERE org_id = ${orgId}
        ${moduleKey ? this.sql`AND module_key = ${moduleKey}` : this.sql``}
      ORDER BY created_at DESC
    `;

    return rows;
  }

  async runReport(orgId: string, id: string, options: { bypassCache?: boolean } = {}): Promise<any> {
    const cacheKey = `cache:report:${id}`;
    if (!options.bypassCache) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch {}
    }

    const report = await this.getReport(orgId, id);
    const mod = await this.modulesService.getByKey(orgId, report.module_key);
    if (!mod) {
      throw new NotFoundError(`Module ${report.module_key} not found`);
    }

    let result: any = null;

    if (report.type === 'funnel') {
      result = await this.computeFunnel(orgId, mod, report);
    } else if (report.type === 'kpi') {
      result = await this.computeKpi(orgId, mod, report);
    } else if (report.type === 'breakdown') {
      result = await this.computeBreakdown(orgId, mod, report);
    } else {
      result = await this.computeFunnel(orgId, mod, report);
    }

    try {
      await this.redis.set(cacheKey, JSON.stringify(result), 'EX', 60);
    } catch {}

    return result;
  }

  private async computeFunnel(orgId: string, mod: any, report: any): Promise<FunnelReportResult> {
    const config = report.config || {};
    let pipelineId = config.pipelineId;

    if (!pipelineId) {
      const [defaultPipeline] = await this.sql<any[]>`
        SELECT id
        FROM pipelines
        WHERE org_id = ${orgId}
          AND module_id = ${mod.id}
          AND deleted_at IS NULL
        ORDER BY is_default DESC, position ASC
        LIMIT 1
      `;
      pipelineId = defaultPipeline?.id;
    }

    const stages = pipelineId
      ? await this.sql<any[]>`
          SELECT *
          FROM pipeline_stages
          WHERE pipeline_id = ${pipelineId}
            AND org_id = ${orgId}
            AND deleted_at IS NULL
          ORDER BY position ASC
        `
      : [];

    const countsRows = await this.sql<any[]>`
      SELECT stage_id, COUNT(id)::int as stage_count
      FROM records
      WHERE org_id = ${orgId}
        AND module_id = ${mod.id}
        AND deleted_at IS NULL
      GROUP BY stage_id
    `;

    const countByStageId = new Map<string, number>();
    let totalRecords = 0;
    for (const row of countsRows) {
      const c = Number(row.stage_count || 0);
      countByStageId.set(row.stage_id, c);
      totalRecords += c;
    }

    const stageItems: FunnelStageItem[] = [];
    let previousCount = 0;

    for (let i = 0; i < stages.length; i++) {
      const stg = stages[i];
      const count = countByStageId.get(stg.id) || 0;
      const conversionRate = totalRecords > 0 ? Number(((count / totalRecords) * 100).toFixed(1)) : 0;
      const dropoffRate = i > 0 && previousCount > 0
        ? Number((Math.max(0, (previousCount - count) / previousCount) * 100).toFixed(1))
        : 0;

      stageItems.push({
        stageId: stg.id,
        stageKey: stg.key,
        stageLabel: stg.label,
        color: stg.color,
        position: stg.position,
        count,
        conversionRate,
        dropoffRate,
      });

      previousCount = count;
    }

    return {
      reportId: report.id,
      reportName: report.name,
      moduleKey: report.module_key,
      pipelineId,
      totalRecords,
      stages: stageItems,
    };
  }

  private async computeKpi(orgId: string, mod: any, report: any): Promise<any> {
    const config = report.config || {};
    const fieldKey = config.fieldKey;

    let aggregateExpr = this.sql`COUNT(r.id)::numeric`;
    if (config.aggregate === 'sum' && fieldKey) {
      aggregateExpr = this.sql`COALESCE(SUM((r.data->>${fieldKey})::numeric), 0)`;
    } else if (config.aggregate === 'avg' && fieldKey) {
      aggregateExpr = this.sql`COALESCE(AVG((r.data->>${fieldKey})::numeric), 0)`;
    }

    const [row] = await this.sql<any[]>`
      SELECT ${aggregateExpr} as metric_value
      FROM records r
      WHERE r.org_id = ${orgId}
        AND r.module_id = ${mod.id}
        AND r.deleted_at IS NULL
    `;

    return {
      reportId: report.id,
      reportName: report.name,
      moduleKey: report.module_key,
      value: Number(row?.metric_value || 0),
      format: config.format || { type: 'number', decimals: 0 },
    };
  }

  private async computeBreakdown(orgId: string, mod: any, report: any): Promise<any> {
    const config = report.config || {};
    const groupField = config.groupBy?.[0]?.fieldKey || 'stage_id';

    const rows = await this.sql<any[]>`
      SELECT
        COALESCE(r.data->>${groupField}, 'Unknown') as bucket_key,
        COUNT(r.id)::int as record_count
      FROM records r
      WHERE r.org_id = ${orgId}
        AND r.module_id = ${mod.id}
        AND r.deleted_at IS NULL
      GROUP BY bucket_key
      ORDER BY record_count DESC
      LIMIT 20
    `;

    return {
      reportId: report.id,
      reportName: report.name,
      moduleKey: report.module_key,
      buckets: rows.map((r) => ({
        key: r.bucket_key,
        count: Number(r.record_count),
      })),
    };
  }

  async drillThrough(
    orgId: string,
    reportId: string,
    bucketKey: string,
    limit = 50,
  ): Promise<DrillThroughItem[]> {
    const report = await this.getReport(orgId, reportId);
    const mod = await this.modulesService.getByKey(orgId, report.module_key);
    if (!mod) {
      throw new NotFoundError(`Module ${report.module_key} not found`);
    }

    let rows: any[] = [];

    if (report.type === 'funnel') {
      const [matchedStage] = await this.sql<any[]>`
        SELECT id
        FROM pipeline_stages
        WHERE org_id = ${orgId}
          AND (id::text = ${bucketKey} OR key = ${bucketKey})
          AND deleted_at IS NULL
        LIMIT 1
      `;

      const targetStageId = matchedStage?.id || bucketKey;

      rows = await this.sql<any[]>`
        SELECT id, display_name, stage_id, owner_id, created_at, data
        FROM records
        WHERE org_id = ${orgId}
          AND module_id = ${mod.id}
          AND stage_id = ${targetStageId}
          AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    } else {
      const groupField = report.config?.groupBy?.[0]?.fieldKey;
      if (groupField) {
        rows = await this.sql<any[]>`
          SELECT id, display_name, stage_id, owner_id, created_at, data
          FROM records
          WHERE org_id = ${orgId}
            AND module_id = ${mod.id}
            AND data->>${groupField} = ${bucketKey}
            AND deleted_at IS NULL
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;
      } else {
        rows = await this.sql<any[]>`
          SELECT id, display_name, stage_id, owner_id, created_at, data
          FROM records
          WHERE org_id = ${orgId}
            AND module_id = ${mod.id}
            AND deleted_at IS NULL
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;
      }
    }

    return rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      stageId: r.stage_id,
      ownerId: r.owner_id,
      createdAt: new Date(r.created_at).toISOString(),
      data: r.data || {},
    }));
  }

  async createDashboard(orgId: string, dto: CreateDashboardDto): Promise<any> {
    if (!dto.name || !dto.name.trim()) {
      throw new ValidationError('Dashboard name is required', [{ field: 'name', message: 'Name is required' }]);
    }

    const [created] = await this.sql<any[]>`
      INSERT INTO dashboards (
        org_id,
        name,
        layout,
        widgets,
        is_default
      ) VALUES (
        ${orgId},
        ${dto.name.trim()},
        ${this.jsonb(dto.layout || [])},
        ${this.jsonb(dto.widgets || [])},
        ${dto.isDefault ?? false}
      )
      RETURNING *
    `;

    return created;
  }

  async updateDashboard(orgId: string, id: string, dto: UpdateDashboardDto): Promise<any> {
    const [existing] = await this.sql<any[]>`
      SELECT *
      FROM dashboards
      WHERE id = ${id}
        AND org_id = ${orgId}
    `;

    if (!existing) {
      throw new NotFoundError(`Dashboard ${id} not found`);
    }

    const [updated] = await this.sql<any[]>`
      UPDATE dashboards
      SET
        name = COALESCE(${dto.name?.trim() ?? null}, name),
        layout = COALESCE(${dto.layout ? this.jsonb(dto.layout) : null}::text::jsonb, layout),
        widgets = COALESCE(${dto.widgets ? this.jsonb(dto.widgets) : null}::text::jsonb, widgets),
        is_default = COALESCE(${dto.isDefault ?? null}, is_default),
        updated_at = now()
      WHERE id = ${id}
        AND org_id = ${orgId}
      RETURNING *
    `;

    return updated;
  }

  async deleteDashboard(orgId: string, id: string): Promise<void> {
    const [row] = await this.sql<any[]>`
      DELETE FROM dashboards
      WHERE id = ${id}
        AND org_id = ${orgId}
      RETURNING id
    `;

    if (!row) {
      throw new NotFoundError(`Dashboard ${id} not found`);
    }
  }

  async getDashboard(orgId: string, id: string): Promise<any> {
    const [dashboard] = await this.sql<any[]>`
      SELECT *
      FROM dashboards
      WHERE id = ${id}
        AND org_id = ${orgId}
    `;

    if (!dashboard) {
      throw new NotFoundError(`Dashboard ${id} not found`);
    }

    return dashboard;
  }

  async listDashboards(orgId: string): Promise<any[]> {
    const rows = await this.sql<any[]>`
      SELECT *
      FROM dashboards
      WHERE org_id = ${orgId}
      ORDER BY is_default DESC, created_at DESC
    `;

    return rows;
  }
}
