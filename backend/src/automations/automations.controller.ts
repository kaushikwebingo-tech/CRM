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
import { AutomationsService, CreateAutomationDto, UpdateAutomationDto } from './automations.service';

@Controller('automations')
export class AutomationsController {
  constructor(private readonly automationsService: AutomationsService) {}

  @Get()
  async list(@CurrentOrg() orgId: string, @Query('moduleId') moduleId?: string) {
    return this.automationsService.list(orgId, moduleId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentOrg() orgId: string, @Body() body: CreateAutomationDto) {
    return this.automationsService.create(orgId, body);
  }

  @Get(':id')
  async get(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.automationsService.getById(orgId, id);
  }

  @Patch(':id')
  async update(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Body() body: UpdateAutomationDto
  ) {
    return this.automationsService.update(orgId, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentOrg() orgId: string, @Param('id') id: string) {
    await this.automationsService.delete(orgId, id);
  }

  @Get(':id/runs')
  async listRuns(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Query('limit') limit?: string
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    return this.automationsService.listRuns(orgId, id, limitNum);
  }
}
