import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CurrentOrg } from '../common/decorators';
import { ReportsService } from './reports.service';
import {
  CreateReportDto,
  UpdateReportDto,
  CreateDashboardDto,
  UpdateDashboardDto,
} from './reports.types';

@Controller()
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('reports')
  async listReports(
    @CurrentOrg() orgId: string,
    @Query('moduleKey') moduleKey?: string,
  ) {
    return this.reportsService.listReports(orgId, moduleKey);
  }

  @Post('reports')
  @HttpCode(HttpStatus.CREATED)
  async createReport(
    @CurrentOrg() orgId: string,
    @Body() body: CreateReportDto,
  ) {
    return this.reportsService.createReport(orgId, body);
  }

  @Get('reports/:id')
  async getReport(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
  ) {
    return this.reportsService.getReport(orgId, id);
  }

  @Patch('reports/:id')
  async updateReport(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Body() body: UpdateReportDto,
  ) {
    return this.reportsService.updateReport(orgId, id, body);
  }

  @Delete('reports/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteReport(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
  ) {
    await this.reportsService.deleteReport(orgId, id);
  }

  @Get('reports/:id/run')
  async runReport(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Query('bypassCache') bypassCache?: string,
  ) {
    return this.reportsService.runReport(orgId, id, {
      bypassCache: bypassCache === 'true',
    });
  }

  @Get('reports/:id/drillthrough')
  async drillThrough(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Query('bucketKey') bucketKey: string,
    @Query('limit') limit?: string,
  ) {
    const maxItems = limit ? parseInt(limit, 10) : 50;
    return this.reportsService.drillThrough(orgId, id, bucketKey, maxItems);
  }

  @Get('dashboards')
  async listDashboards(@CurrentOrg() orgId: string) {
    return this.reportsService.listDashboards(orgId);
  }

  @Post('dashboards')
  @HttpCode(HttpStatus.CREATED)
  async createDashboard(
    @CurrentOrg() orgId: string,
    @Body() body: CreateDashboardDto,
  ) {
    return this.reportsService.createDashboard(orgId, body);
  }

  @Get('dashboards/:id')
  async getDashboard(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
  ) {
    return this.reportsService.getDashboard(orgId, id);
  }

  @Patch('dashboards/:id')
  async updateDashboard(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Body() body: UpdateDashboardDto,
  ) {
    return this.reportsService.updateDashboard(orgId, id, body);
  }

  @Delete('dashboards/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDashboard(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
  ) {
    await this.reportsService.deleteDashboard(orgId, id);
  }
}
