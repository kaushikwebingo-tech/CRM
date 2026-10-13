import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CurrentOrg, CurrentUser } from '../common/decorators';
import { ConsentService } from './consent.service';
import { RecordConsentDto, WithdrawConsentDto } from './consent.types';

@Controller('consents')
export class ConsentController {
  constructor(private readonly consentService: ConsentService) {}

  @Get('check')
  async checkConsent(
    @CurrentOrg() orgId: string,
    @Query('recordId') recordId: string,
    @Query('channel') channel: any,
    @Query('purpose') purpose?: any,
  ) {
    return this.consentService.checkConsent(orgId, recordId, channel, purpose || 'utility');
  }

  @Get('records/:recordId')
  async listForRecord(
    @CurrentOrg() orgId: string,
    @Param('recordId') recordId: string,
  ) {
    return this.consentService.listForRecord(orgId, recordId);
  }

  @Get('record/:recordId')
  async listForRecordAlias(
    @CurrentOrg() orgId: string,
    @Param('recordId') recordId: string,
  ) {
    return this.consentService.listForRecord(orgId, recordId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async recordConsent(
    @CurrentOrg() orgId: string,
    @Body() body: RecordConsentDto,
  ) {
    return this.consentService.recordConsent(orgId, body);
  }

  @Post('withdraw')
  @HttpCode(HttpStatus.OK)
  async withdrawConsent(
    @CurrentOrg() orgId: string,
    @Body() body: WithdrawConsentDto,
  ) {
    const count = await this.consentService.withdrawConsent(orgId, body);
    return { success: true, count };
  }
}
