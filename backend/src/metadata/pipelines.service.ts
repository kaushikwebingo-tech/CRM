import { Injectable, Inject } from '@nestjs/common';
import { z } from 'zod';
import { DATABASE } from '../db/connection';
import { pipelines, pipelineStages, records } from '../db/schema';
import { eq, and, isNull, asc, ne, sql as drizzleSql } from 'drizzle-orm';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../common/errors';
import { ModulesService } from './modules.service';
import { AuditService } from './audit.service';

const pipelineSchema = z.object({
  name: z.string().min(1).max(120),
  isDefault: z.boolean().optional(),
  position: z.number().int().min(0).max(10_000).optional(),
});

const stageSchema = z.object({
  key: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/, 'Key must be snake_case'),
  label: z.string().min(1).max(120),
  type: z.enum(['open', 'won', 'lost']).default('open'),
  probability: z.number().min(0).max(100).nullable().optional(),
  color: z.string().max(40).nullable().optional(),
  position: z.number().int().min(0).max(10_000).optional(),
});

const stageUpdateSchema = stageSchema.partial().omit({ key: true });

@Injectable()
export class PipelinesService {
  constructor(
    @Inject(DATABASE) private readonly db: any,
    private readonly modulesService: ModulesService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Resolves a pipeline and proves it belongs to the caller's org.
   *
   * Stage reads and writes previously filtered on `pipelineId` alone, so a
   * pipeline id from another organisation was accepted — a cross-tenant read
   * and write of someone else's pipeline configuration.
   */
  private async requirePipeline(orgId: string, pipelineId: string) {
    const [pipeline] = await this.db
      .select()
      .from(pipelines)
      .where(and(eq(pipelines.id, pipelineId), eq(pipelines.orgId, orgId), isNull(pipelines.deletedAt)))
      .limit(1);
    if (!pipeline) throw new NotFoundError('Pipeline not found');
    return pipeline;
  }

  private async requireStage(orgId: string, stageId: string) {
    const [stage] = await this.db
      .select()
      .from(pipelineStages)
      .where(
        and(
          eq(pipelineStages.id, stageId),
          eq(pipelineStages.orgId, orgId),
          isNull(pipelineStages.deletedAt),
        ),
      )
      .limit(1);
    if (!stage) throw new NotFoundError('Stage not found');
    return stage;
  }

  async listPipelines(orgId: string, moduleId: string) {
    return this.db
      .select()
      .from(pipelines)
      .where(and(eq(pipelines.orgId, orgId), eq(pipelines.moduleId, moduleId), isNull(pipelines.deletedAt)))
      .orderBy(asc(pipelines.position));
  }

  async createPipeline(orgId: string, moduleId: string, input: unknown, actorId?: string) {
    const data = pipelineSchema.parse(input ?? {});

    return this.db.transaction(async (tx: any) => {
      if (data.isDefault) {
        await tx
          .update(pipelines)
          .set({ isDefault: false })
          .where(and(eq(pipelines.orgId, orgId), eq(pipelines.moduleId, moduleId)));
      }

      const [pipeline] = await tx
        .insert(pipelines)
        .values({
          orgId,
          moduleId,
          name: data.name,
          isDefault: data.isDefault ?? false,
          position: data.position ?? 0,
        })
        .returning();

      // The pipeline and its stages are part of the compiled schema the client
      // renders from, so a change has to invalidate it.
      await this.modulesService.bumpSchemaVersion(moduleId, tx);
      await this.audit.record(tx, {
        orgId, actorId, entityType: 'pipeline', entityId: pipeline.id,
        action: 'created', after: pipeline,
      });
      return pipeline;
    });
  }

  async updatePipeline(orgId: string, pipelineId: string, input: unknown, actorId?: string) {
    const existing = await this.requirePipeline(orgId, pipelineId);
    const data = pipelineSchema.partial().parse(input ?? {});

    return this.db.transaction(async (tx: any) => {
      if (data.isDefault) {
        await tx
          .update(pipelines)
          .set({ isDefault: false })
          .where(and(eq(pipelines.orgId, orgId), eq(pipelines.moduleId, existing.moduleId)));
      }

      const [pipeline] = await tx
        .update(pipelines)
        .set({
          ...(data.name !== undefined && { name: data.name }),
          ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
          ...(data.position !== undefined && { position: data.position }),
        })
        .where(eq(pipelines.id, pipelineId))
        .returning();

      await this.modulesService.bumpSchemaVersion(existing.moduleId, tx);
      await this.audit.record(tx, {
        orgId, actorId, entityType: 'pipeline', entityId: pipelineId,
        action: 'updated', before: existing, after: pipeline,
      });
      return pipeline;
    });
  }

  /**
   * Deleting a pipeline would orphan the `stage_id` of every record in it, so
   * it is blocked while any record still points at one of its stages.
   */
  async softDeletePipeline(orgId: string, pipelineId: string, actorId?: string) {
    const existing = await this.requirePipeline(orgId, pipelineId);

    const [inUse] = await this.db
      .select({ id: records.id })
      .from(records)
      .innerJoin(pipelineStages, eq(records.stageId, pipelineStages.id))
      .where(and(eq(pipelineStages.pipelineId, pipelineId), isNull(records.deletedAt)))
      .limit(1);
    if (inUse) {
      throw new ConflictError(
        'This pipeline still has records in its stages. Move them to another pipeline first.',
      );
    }

    await this.db.transaction(async (tx: any) => {
      await tx.update(pipelines).set({ deletedAt: new Date() }).where(eq(pipelines.id, pipelineId));
      await tx
        .update(pipelineStages)
        .set({ deletedAt: new Date() })
        .where(eq(pipelineStages.pipelineId, pipelineId));
      await this.modulesService.bumpSchemaVersion(existing.moduleId, tx);
      await this.audit.record(tx, {
        orgId, actorId, entityType: 'pipeline', entityId: pipelineId,
        action: 'deleted', before: existing,
      });
    });
  }

  async listStages(orgId: string, pipelineId: string) {
    await this.requirePipeline(orgId, pipelineId);
    return this.db
      .select()
      .from(pipelineStages)
      .where(
        and(
          eq(pipelineStages.orgId, orgId),
          eq(pipelineStages.pipelineId, pipelineId),
          isNull(pipelineStages.deletedAt),
        ),
      )
      .orderBy(asc(pipelineStages.position));
  }

  async createStage(orgId: string, pipelineId: string, input: unknown, actorId?: string) {
    const pipeline = await this.requirePipeline(orgId, pipelineId);
    const data = stageSchema.parse(input ?? {});

    return this.db.transaction(async (tx: any) => {
      const [stage] = await tx
        .insert(pipelineStages)
        .values({
          orgId,
          pipelineId,
          key: data.key,
          label: data.label,
          type: data.type,
          probability: data.probability ?? null,
          color: data.color ?? null,
          position: data.position ?? 0,
        })
        .returning();

      await this.modulesService.bumpSchemaVersion(pipeline.moduleId, tx);
      await this.audit.record(tx, {
        orgId, actorId, entityType: 'stage', entityId: stage.id,
        action: 'created', after: stage,
      });
      return stage;
    });
  }

  async updateStage(orgId: string, stageId: string, input: unknown, actorId?: string) {
    const existing = await this.requireStage(orgId, stageId);
    const pipeline = await this.requirePipeline(orgId, existing.pipelineId);
    const data = stageUpdateSchema.parse(input ?? {});

    return this.db.transaction(async (tx: any) => {
      const [stage] = await tx
        .update(pipelineStages)
        .set({
          ...(data.label !== undefined && { label: data.label }),
          ...(data.type !== undefined && { type: data.type }),
          ...(data.probability !== undefined && { probability: data.probability }),
          ...(data.color !== undefined && { color: data.color }),
          ...(data.position !== undefined && { position: data.position }),
        })
        .where(eq(pipelineStages.id, stageId))
        .returning();

      await this.modulesService.bumpSchemaVersion(pipeline.moduleId, tx);
      await this.audit.record(tx, {
        orgId, actorId, entityType: 'stage', entityId: stageId,
        action: 'updated', before: existing, after: stage,
      });
      return stage;
    });
  }

  /**
   * Plan Section 9: "Blocked while records sit in it. The UI asks the admin to
   * pick a destination stage, moves those records in one bulk update, then
   * soft-deletes the stage. Never orphan a record's stage_id."
   */
  async softDeleteStage(
    orgId: string,
    stageId: string,
    options: { moveToStageId?: string } = {},
    actorId?: string,
  ) {
    const existing = await this.requireStage(orgId, stageId);
    const pipeline = await this.requirePipeline(orgId, existing.pipelineId);

    const [stageCount] = await this.db
      .select({ remaining: drizzleSql<number>`count(*)::int` })
      .from(pipelineStages)
      .where(
        and(
          eq(pipelineStages.pipelineId, existing.pipelineId),
          ne(pipelineStages.id, stageId),
          isNull(pipelineStages.deletedAt),
        ),
      );
    if (!stageCount || stageCount.remaining === 0) {
      throw new ConflictError('A pipeline must keep at least one stage');
    }

    const [occupied] = await this.db
      .select({ id: records.id })
      .from(records)
      .where(and(eq(records.stageId, stageId), isNull(records.deletedAt)))
      .limit(1);

    if (occupied && !options.moveToStageId) {
      throw new ConflictError(
        'This stage still has records. Choose a stage to move them to before deleting it.',
      );
    }

    let movedTo: string | null = null;
    if (options.moveToStageId) {
      const destination = await this.requireStage(orgId, options.moveToStageId);
      if (destination.pipelineId !== existing.pipelineId) {
        throw new ValidationError('The destination stage must belong to the same pipeline', [
          { field: 'moveToStageId', message: 'Must be a stage of the same pipeline' },
        ]);
      }
      if (destination.id === stageId) {
        throw new ValidationError('The destination stage cannot be the stage being deleted', [
          { field: 'moveToStageId', message: 'Choose a different stage' },
        ]);
      }
      movedTo = destination.id;
    }

    await this.db.transaction(async (tx: any) => {
      if (movedTo) {
        await tx
          .update(records)
          .set({ stageId: movedTo, stageSince: new Date(), updatedAt: new Date() })
          .where(and(eq(records.stageId, stageId), isNull(records.deletedAt)));
      }
      await tx
        .update(pipelineStages)
        .set({ deletedAt: new Date() })
        .where(eq(pipelineStages.id, stageId));

      await this.modulesService.bumpSchemaVersion(pipeline.moduleId, tx);
      await this.audit.record(tx, {
        orgId, actorId, entityType: 'stage', entityId: stageId,
        action: 'deleted', before: existing,
        after: movedTo ? { movedRecordsTo: movedTo } : null,
      });
    });
  }

  async reorderStages(orgId: string, pipelineId: string, orderedKeys: unknown, actorId?: string) {
    const pipeline = await this.requirePipeline(orgId, pipelineId);
    const keys = z.array(z.string()).max(200).parse(orderedKeys);

    await this.db.transaction(async (tx: any) => {
      for (let i = 0; i < keys.length; i++) {
        await tx
          .update(pipelineStages)
          .set({ position: i })
          .where(
            and(
              eq(pipelineStages.orgId, orgId),
              eq(pipelineStages.pipelineId, pipelineId),
              eq(pipelineStages.key, keys[i]),
            ),
          );
      }
      await this.modulesService.bumpSchemaVersion(pipeline.moduleId, tx);
      await this.audit.record(tx, {
        orgId, actorId, entityType: 'stage', entityId: pipelineId,
        action: 'reordered', after: { order: keys },
      });
    });
  }
}
