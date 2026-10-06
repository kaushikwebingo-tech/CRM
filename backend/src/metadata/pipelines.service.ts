import { Injectable, Inject } from '@nestjs/common';
import { DATABASE } from '../db/connection';
import { pipelines, pipelineStages, records } from '../db/schema';
import { eq, and, isNull, asc } from 'drizzle-orm';
import { ConflictError, ForbiddenError, NotFoundError } from '../common/errors';

@Injectable()
export class PipelinesService {
  constructor(@Inject(DATABASE) private readonly db: any) {}

  async listPipelines(orgId: string, moduleId: string) {
    return this.db.select().from(pipelines).where(and(eq(pipelines.moduleId, moduleId), isNull(pipelines.deletedAt))).orderBy(asc(pipelines.position));
  }

  async createPipeline(orgId: string, moduleId: string, data: any) {
    const [pipeline] = await this.db.insert(pipelines).values({ orgId, moduleId, ...data }).returning();
    return pipeline;
  }

  async updatePipeline(orgId: string, pipelineId: string, data: any) {
    const [pipeline] = await this.db.update(pipelines).set(data).where(and(eq(pipelines.id, pipelineId), eq(pipelines.orgId, orgId))).returning();
    if (!pipeline) throw new NotFoundError('Pipeline not found');
    return pipeline;
  }

  async softDeletePipeline(orgId: string, pipelineId: string) {
    await this.db.update(pipelines).set({ deletedAt: new Date() }).where(and(eq(pipelines.id, pipelineId), eq(pipelines.orgId, orgId)));
  }

  async listStages(orgId: string, pipelineId: string) {
    return this.db.select().from(pipelineStages).where(and(eq(pipelineStages.pipelineId, pipelineId), isNull(pipelineStages.deletedAt))).orderBy(asc(pipelineStages.position));
  }

  async createStage(orgId: string, pipelineId: string, data: any) {
    const [stage] = await this.db.insert(pipelineStages).values({ orgId, pipelineId, ...data }).returning();
    return stage;
  }

  async updateStage(orgId: string, stageId: string, data: any) {
    const [stage] = await this.db.update(pipelineStages).set(data).where(and(eq(pipelineStages.id, stageId), eq(pipelineStages.orgId, orgId))).returning();
    if (!stage) throw new NotFoundError('Stage not found');
    return stage;
  }

  async softDeleteStage(orgId: string, stageId: string) {
    const [record] = await this.db.select().from(records).where(and(eq(records.stageId, stageId), isNull(records.deletedAt))).limit(1);
    if (record) throw new ForbiddenError('Cannot delete stage with active records');
    await this.db.update(pipelineStages).set({ deletedAt: new Date() }).where(and(eq(pipelineStages.id, stageId), eq(pipelineStages.orgId, orgId)));
  }

  async reorderStages(orgId: string, pipelineId: string, orderedKeys: string[]) {
    await this.db.transaction(async (tx: any) => {
      for (let i = 0; i < orderedKeys.length; i++) {
        await tx.update(pipelineStages).set({ position: i }).where(and(eq(pipelineStages.pipelineId, pipelineId), eq(pipelineStages.key, orderedKeys[i])));
      }
    });
  }
}
