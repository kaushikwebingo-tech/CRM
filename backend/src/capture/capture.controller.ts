import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CurrentOrg, CurrentUser } from '../common/decorators';
import { Public } from '../auth/auth.guard';
import { CaptureService } from './capture.service';
import {
  CreateLeadSourceDto,
  UpdateLeadSourceDto,
} from './capture.types';

@Controller()
export class CaptureController {
  constructor(private readonly captureService: CaptureService) {}

  @Get('capture/sources')
  async listSources(@CurrentOrg() orgId: string) {
    return this.captureService.listSources(orgId);
  }

  @Post('capture/sources')
  @HttpCode(HttpStatus.CREATED)
  async createSource(
    @CurrentOrg() orgId: string,
    @Body() body: CreateLeadSourceDto,
  ) {
    return this.captureService.createSource(orgId, body);
  }

  @Get('capture/sources/:id')
  async getSource(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
  ) {
    return this.captureService.getSource(orgId, id);
  }

  @Patch('capture/sources/:id')
  async updateSource(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Body() body: UpdateLeadSourceDto,
  ) {
    return this.captureService.updateSource(orgId, id, body);
  }

  @Delete('capture/sources/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSource(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
  ) {
    await this.captureService.deleteSource(orgId, id);
  }

  @Get('capture/quarantine')
  async listQuarantine(
    @CurrentOrg() orgId: string,
    @Query('status') status?: string,
  ) {
    return this.captureService.listQuarantine(orgId, status);
  }

  @Post('capture/quarantine/:id/replay')
  @HttpCode(HttpStatus.OK)
  async replayQuarantine(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Body() body?: { overrides?: Record<string, unknown> },
  ) {
    return this.captureService.replayQuarantine(orgId, id, body?.overrides);
  }

  @Delete('capture/quarantine/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async discardQuarantine(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
  ) {
    await this.captureService.discardQuarantine(orgId, id);
  }

  @Public()
  @Get('public/forms/:sourceId')
  async getPublicForm(@Param('sourceId') sourceId: string) {
    return this.captureService.getPublicFormDefinition(sourceId);
  }

  @Public()
  @Post('public/forms/:sourceId/submit')
  @HttpCode(HttpStatus.OK)
  async submitPublicForm(
    @Param('sourceId') sourceId: string,
    @Body() body: Record<string, unknown>,
    @Req() req?: any,
  ) {
    const ip = req?.ip || req?.headers?.['x-forwarded-for'] || '127.0.0.1';
    return this.captureService.processSubmission(sourceId, body, String(ip));
  }
}
