import { Query, Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { PipelinesService } from './pipelines.service';
import { ModulesService } from './modules.service';
import { CurrentOrg, CurrentUser } from '../common/decorators';
import { z } from 'zod';
import { RequireAdmin } from '../auth/permissions.guard';

const createPipelineSchema = z.object({
  name: z.string(),
  isDefault: z.boolean().optional(),
  position: z.number().optional(),
});
const updatePipelineSchema = createPipelineSchema.partial();

const createStageSchema = z.object({
  key: z.string(),
  label: z.string(),
  color: z.string().optional(),
  type: z.string().optional(),
  probability: z.number().optional(),
  position: z.number().optional(),
});
const updateStageSchema = createStageSchema.partial();
const reorderSchema = z.object({ orderedKeys: z.array(z.string()) });

@Controller()
export class PipelinesController {
  constructor(
    private readonly pipelinesService: PipelinesService,
    private readonly modulesService: ModulesService,
  ) {}

  @Get('modules/:moduleKey/pipelines')
  async listPipelines(@CurrentOrg() orgId: string, @Param('moduleKey') moduleKey: string) {
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    return this.pipelinesService.listPipelines(orgId, mod.id);
  }

  @RequireAdmin('manageModules', 'change pipelines and stages')
  @Post('modules/:moduleKey/pipelines')
  async createPipeline(
    @CurrentOrg() orgId: string,
    @Param('moduleKey') moduleKey: string,
    @Body() body: unknown,
    @CurrentUser() user: { id: string },
  ) {
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    return this.pipelinesService.createPipeline(orgId, mod.id, body, user?.id);
  }

  @RequireAdmin('manageModules', 'change pipelines and stages')
  @Patch('modules/:moduleKey/pipelines/:id')
  async updatePipeline(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: { id: string },
  ) {
    return this.pipelinesService.updatePipeline(orgId, id, body, user?.id);
  }

  @RequireAdmin('manageModules', 'change pipelines and stages')
  @Delete('modules/:moduleKey/pipelines/:id')
  async deletePipeline(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    await this.pipelinesService.softDeletePipeline(orgId, id, user?.id);
    return { success: true };
  }

  @Get('pipelines/:pipelineId/stages')
  async listStages(@CurrentOrg() orgId: string, @Param('pipelineId') pipelineId: string) {
    return this.pipelinesService.listStages(orgId, pipelineId);
  }

  @RequireAdmin('manageModules', 'change pipelines and stages')
  @Post('pipelines/:pipelineId/stages')
  async createStage(
    @CurrentOrg() orgId: string,
    @Param('pipelineId') pipelineId: string,
    @Body() body: unknown,
    @CurrentUser() user: { id: string },
  ) {
    return this.pipelinesService.createStage(orgId, pipelineId, body, user?.id);
  }

  @RequireAdmin('manageModules', 'change pipelines and stages')
  @Patch('pipelines/:pipelineId/stages/:id')
  async updateStage(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: { id: string },
  ) {
    return this.pipelinesService.updateStage(orgId, id, body, user?.id);
  }

  @RequireAdmin('manageModules', 'change pipelines and stages')
  @Delete('pipelines/:pipelineId/stages/:id')
  async deleteStage(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Query('moveToStageId') moveToStageId: string | undefined,
    @CurrentUser() user: { id: string },
  ) {
    // Plan Section 9: records are moved to a destination stage first, so a
    // delete can never orphan a record's stage_id.
    await this.pipelinesService.softDeleteStage(orgId, id, { moveToStageId }, user?.id);
    return { success: true };
  }

  @RequireAdmin('manageModules', 'change pipelines and stages')
  @Post('pipelines/:pipelineId/stages/reorder')
  async reorderStages(
    @CurrentOrg() orgId: string,
    @Param('pipelineId') pipelineId: string,
    @Body() body: any,
    @CurrentUser() user: { id: string },
  ) {
    const data = reorderSchema.parse(body);
    await this.pipelinesService.reorderStages(orgId, pipelineId, data.orderedKeys, user?.id);
    return { success: true };
  }
}
