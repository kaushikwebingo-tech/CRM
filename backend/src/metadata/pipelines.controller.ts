import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { PipelinesService } from './pipelines.service';
import { ModulesService } from './modules.service';
import { CurrentOrg } from '../common/decorators';
import { z } from 'zod';

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

  @Post('modules/:moduleKey/pipelines')
  async createPipeline(@CurrentOrg() orgId: string, @Param('moduleKey') moduleKey: string, @Body() body: any) {
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const data = createPipelineSchema.parse(body);
    return this.pipelinesService.createPipeline(orgId, mod.id, data);
  }

  @Patch('modules/:moduleKey/pipelines/:id')
  async updatePipeline(@CurrentOrg() orgId: string, @Param('id') id: string, @Body() body: any) {
    const data = updatePipelineSchema.parse(body);
    return this.pipelinesService.updatePipeline(orgId, id, data);
  }

  @Delete('modules/:moduleKey/pipelines/:id')
  async deletePipeline(@CurrentOrg() orgId: string, @Param('id') id: string) {
    await this.pipelinesService.softDeletePipeline(orgId, id);
    return { success: true };
  }

  @Get('pipelines/:pipelineId/stages')
  async listStages(@CurrentOrg() orgId: string, @Param('pipelineId') pipelineId: string) {
    return this.pipelinesService.listStages(orgId, pipelineId);
  }

  @Post('pipelines/:pipelineId/stages')
  async createStage(@CurrentOrg() orgId: string, @Param('pipelineId') pipelineId: string, @Body() body: any) {
    const data = createStageSchema.parse(body);
    return this.pipelinesService.createStage(orgId, pipelineId, data);
  }

  @Patch('pipelines/:pipelineId/stages/:id')
  async updateStage(@CurrentOrg() orgId: string, @Param('id') id: string, @Body() body: any) {
    const data = updateStageSchema.parse(body);
    return this.pipelinesService.updateStage(orgId, id, data);
  }

  @Delete('pipelines/:pipelineId/stages/:id')
  async deleteStage(@CurrentOrg() orgId: string, @Param('id') id: string) {
    await this.pipelinesService.softDeleteStage(orgId, id);
    return { success: true };
  }

  @Post('pipelines/:pipelineId/stages/reorder')
  async reorderStages(@CurrentOrg() orgId: string, @Param('pipelineId') pipelineId: string, @Body() body: any) {
    const data = reorderSchema.parse(body);
    await this.pipelinesService.reorderStages(orgId, pipelineId, data.orderedKeys);
    return { success: true };
  }
}
