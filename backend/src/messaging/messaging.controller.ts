import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Inject,
  Req,
} from '@nestjs/common';
import { CurrentOrg, CurrentUser } from '../common/decorators';
import { Public } from '../auth/auth.guard';
import { MessagingService } from './messaging.service';
import {
  OutboundWhatsAppDto,
  OutboundSmsDto,
} from './messaging.types';

@Controller('messaging')
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  @Post('whatsapp/send')
  async sendWhatsApp(
    @CurrentOrg() orgId: string,
    @CurrentUser() user: any,
    @Body() body: OutboundWhatsAppDto,
  ) {
    return this.messagingService.sendWhatsApp(orgId, body, user?.id);
  }

  @Post('sms/send')
  async sendSms(
    @CurrentOrg() orgId: string,
    @CurrentUser() user: any,
    @Body() body: OutboundSmsDto,
  ) {
    return this.messagingService.sendSms(orgId, body, user?.id);
  }

  @Get('records/:recordId/session-window')
  async getSessionWindow(
    @CurrentOrg() orgId: string,
    @Param('recordId') recordId: string,
  ) {
    return this.messagingService.getSessionWindow(orgId, recordId);
  }

  @Get('whatsapp/session-window/:recordId')
  async getWhatsAppSessionWindow(
    @CurrentOrg() orgId: string,
    @Param('recordId') recordId: string,
  ) {
    return this.messagingService.getSessionWindow(orgId, recordId);
  }
}
