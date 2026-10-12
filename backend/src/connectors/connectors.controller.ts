import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CurrentOrg } from '../common/decorators';
import {
  ConnectorsService,
  CreateConnectorDto,
  UpdateConnectorDto,
} from './connectors.service';
import { RequireAdmin } from '../auth/permissions.guard';

@Controller('connectors')
export class ConnectorsController {
  constructor(private readonly connectorsService: ConnectorsService) {}

  @Get('providers')
  getProviders() {
    return this.connectorsService.getProviders();
  }

  @Get()
  async list(@CurrentOrg() orgId: string) {
    return this.connectorsService.list(orgId);
  }

  @RequireAdmin('manageConnectors', 'create a connector')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentOrg() orgId: string, @Body() body: CreateConnectorDto) {
    return this.connectorsService.create(orgId, body);
  }

  @Get(':id')
  async get(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.connectorsService.getById(orgId, id);
  }

  @RequireAdmin('manageConnectors', 'update a connector')
  @Patch(':id')
  async update(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Body() body: UpdateConnectorDto,
  ) {
    return this.connectorsService.update(orgId, id, body);
  }

  @RequireAdmin('manageConnectors', 'delete a connector')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentOrg() orgId: string, @Param('id') id: string) {
    await this.connectorsService.delete(orgId, id);
  }

  @Post(':id/health-check')
  async healthCheck(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.connectorsService.runHealthCheck(orgId, id);
  }

  @RequireAdmin('manageConnectors', 'send test email')
  @Post(':id/test-email')
  async sendTestEmail(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Body() body: { toEmail: string; subject?: string; text?: string },
  ) {
    return this.connectorsService.sendTestEmail(orgId, id, body);
  }
}
