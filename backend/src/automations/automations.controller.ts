import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CurrentOrg } from '../common/decorators';
import {
  AutomationsService,
  CreateAutomationDto,
  UpdateAutomationDto,
  DryRunDto,
} from './automations.service';
import { RequireAdmin } from '../auth/permissions.guard';

@Controller('automations')
export class AutomationsController {
  constructor(private readonly automationsService: AutomationsService) {}

  @Get()
  async list(@CurrentOrg() orgId: string, @Query('moduleId') moduleId?: string) {
    return this.automationsService.list(orgId, moduleId);
  }

  @RequireAdmin('manageAutomations', 'create an automation')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentOrg() orgId: string, @Body() body: CreateAutomationDto) {
    return this.automationsService.create(orgId, body);
  }

  @RequireAdmin('manageAutomations', 'test an automation')
  @Post('test')
  async testDraft(@CurrentOrg() orgId: string, @Body() body: DryRunDto) {
    return this.automationsService.dryRun(orgId, {
      recordId: body.recordId,
      rule: body.rule,
    });
  }

  @RequireAdmin('manageAutomations', 'test an automation')
  @Post(':id/test')
  async testExisting(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Body() body: DryRunDto,
  ) {
    return this.automationsService.dryRun(orgId, {
      automationId: id,
      recordId: body.recordId,
      rule: body.rule,
    });
  }

  @Get('runs/:runId')
  async getRun(@CurrentOrg() orgId: string, @Param('runId') runId: string) {
    return this.automationsService.getRunById(orgId, parseInt(runId, 10));
  }

  @Get(':id')
  async get(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.automationsService.getById(orgId, id);
  }

  @RequireAdmin('manageAutomations', 'change an automation')
  @Patch(':id')
  async update(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Body() body: UpdateAutomationDto,
  ) {
    return this.automationsService.update(orgId, id, body);
  }

  @RequireAdmin('manageAutomations', 'delete an automation')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentOrg() orgId: string, @Param('id') id: string) {
    await this.automationsService.delete(orgId, id);
  }

  @Get(':id/runs')
  async listRuns(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    return this.automationsService.listRuns(orgId, id, limitNum);
  }
}
