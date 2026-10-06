import { Controller, Get, Post, Patch, Delete, Param, Query, Body, Headers, Res } from '@nestjs/common';
import { RecordsService, RecordListQuery, CurrentUserPayload } from './records.service';
import { CurrentUser, CurrentOrg } from '../common/decorators';

@Controller('modules/:key/records')
export class RecordsController {
  constructor(private readonly recordsService: RecordsService) {}

  @Get()
  async list(
    @CurrentOrg() orgId: string,
    @Param('key') moduleKey: string,
    @Query() query: RecordListQuery,
    @CurrentUser() currentUser: CurrentUserPayload
  ) {
    const result = await this.recordsService.list(orgId, moduleKey, query, currentUser);
    return result;
  }

  @Get('count')
  async count(
    @CurrentOrg() orgId: string,
    @Param('key') moduleKey: string,
    @Query('filter') filter: string,
    @CurrentUser() currentUser: CurrentUserPayload
  ) {
    return this.recordsService.count(orgId, moduleKey, filter, currentUser);
  }

  @Post()
  async create(
    @CurrentOrg() orgId: string,
    @Param('key') moduleKey: string,
    @Body() body: any,
    @CurrentUser() currentUser: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    const record = await this.recordsService.create(orgId, moduleKey, body, currentUser, idempotencyKey);
    return record;
  }

  @Post('bulk')
  async bulk(
    @CurrentOrg() orgId: string,
    @Param('key') moduleKey: string,
    @Body() body: any,
    @CurrentUser() currentUser: CurrentUserPayload
  ) {
    return this.recordsService.bulkAction(orgId, moduleKey, body, currentUser);
  }

  @Get('export')
  async export(
    @CurrentOrg() orgId: string,
    @Param('key') moduleKey: string,
    @Query() query: RecordListQuery,
    @CurrentUser() currentUser: CurrentUserPayload,
    @Res({ passthrough: true }) res: any
  ) {
    const csvData = await this.recordsService.exportCsv(orgId, moduleKey, query, currentUser);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${moduleKey}-export.csv"`);
    return csvData;
  }

  @Post('import')
  async import(
    @CurrentOrg() orgId: string,
    @Param('key') moduleKey: string,
    @Body() body: any,
    @CurrentUser() currentUser: CurrentUserPayload
  ) {
    const csvContent = typeof body === 'string' ? body : body.csv || body.csvText || '';
    const mappings = body.mappings || {};
    return this.recordsService.importCsv(orgId, moduleKey, csvContent, mappings, currentUser);
  }

  @Get(':id')
  async getById(
    @CurrentOrg() orgId: string,
    @Param('key') moduleKey: string,
    @Param('id') recordId: string
  ) {
    return this.recordsService.findById(orgId, moduleKey, recordId);
  }

  @Patch(':id')
  async update(
    @CurrentOrg() orgId: string,
    @Param('key') moduleKey: string,
    @Param('id') recordId: string,
    @Body() body: any,
    @CurrentUser() currentUser: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    return this.recordsService.update(orgId, moduleKey, recordId, body, currentUser, idempotencyKey);
  }

  @Patch(':id/stage')
  async changeStage(
    @CurrentOrg() orgId: string,
    @Param('key') moduleKey: string,
    @Param('id') recordId: string,
    @Body('stage_id') stageId: string,
    @CurrentUser() currentUser: CurrentUserPayload
  ) {
    return this.recordsService.changeStage(orgId, moduleKey, recordId, stageId, currentUser);
  }

  @Get(':id/timeline')
  async getTimeline(
    @CurrentOrg() orgId: string,
    @Param('key') moduleKey: string,
    @Param('id') recordId: string
  ) {
    return this.recordsService.getTimeline(orgId, moduleKey, recordId);
  }

  @Delete(':id')
  async delete(
    @CurrentOrg() orgId: string,
    @Param('key') moduleKey: string,
    @Param('id') recordId: string,
    @CurrentUser() currentUser: CurrentUserPayload
  ) {
    return this.recordsService.delete(orgId, moduleKey, recordId, currentUser);
  }
}
