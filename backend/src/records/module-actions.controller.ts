import { Controller, Get, Post, Param, Query, Body, Res } from '@nestjs/common';
import { RecordsService, RecordListQuery, CurrentUserPayload } from './records.service';
import { CurrentUser, CurrentOrg } from '../common/decorators';

@Controller('modules/:key')
export class ModuleActionsController {
  constructor(private readonly recordsService: RecordsService) {}

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
}
