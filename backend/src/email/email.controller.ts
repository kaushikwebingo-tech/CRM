import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Inject,
  forwardRef,
  Req,
} from '@nestjs/common';
import { PG_CLIENT } from '../db/connection';
import postgres from 'postgres';
import { CurrentOrg, CurrentUser } from '../common/decorators';
import { Public } from '../auth/auth.guard';
import { EmailService } from './email.service';
import { SuppressionService } from './suppression.service';
import { MessagingService } from '../messaging/messaging.service';
import {
  OutboundEmailDto,
  InboundEmailInput,
  BounceEventInput,
  MessageChannel,
} from './email.types';

@Controller()
export class EmailController {
  constructor(
    @Inject(PG_CLIENT) private readonly sql: postgres.Sql,
    private readonly emailService: EmailService,
    private readonly suppressionService: SuppressionService,
    @Inject(forwardRef(() => MessagingService)) private readonly messagingService: MessagingService,
  ) {}

  @Post('email/send')
  async send(
    @CurrentOrg() orgId: string,
    @CurrentUser() user: any,
    @Body() body: OutboundEmailDto,
  ) {
    return this.emailService.sendOutbound(orgId, {
      ...body,
      sentBy: user?.id,
    });
  }

  @Get('email/records/:recordId')
  async getRecordMessages(
    @CurrentOrg() orgId: string,
    @Param('recordId') recordId: string,
  ) {
    return this.emailService.getRecordMessages(orgId, recordId);
  }

  @Get('email/threads/:threadId')
  async getThreadMessages(
    @CurrentOrg() orgId: string,
    @Param('threadId') threadId: string,
  ) {
    return this.emailService.getThreadMessages(orgId, threadId);
  }

  @Get('email/suppressions')
  async listSuppressions(
    @CurrentOrg() orgId: string,
    @Query('channel') channel?: MessageChannel,
  ) {
    return this.suppressionService.list(orgId, channel || 'email');
  }

  @Delete('email/suppressions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSuppression(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
  ) {
    await this.suppressionService.unsuppress(orgId, id);
  }

  @Public()
  @Get('inbound/:connectorId')
  async verifyInbound(
    @Param('connectorId') connectorId: string,
    @Query('orgId') queryOrgId?: string,
    @Req() req?: any,
  ) {
    let orgId = queryOrgId;
    const [c] = await this.sql<any[]>`
      SELECT org_id, provider_key FROM connectors WHERE id = ${connectorId}
    `;
    if (!orgId) orgId = c?.org_id;
    if (!orgId) {
      return { success: false, error: 'Connector or organization not found' };
    }

    const result = await this.messagingService.processInbound(
      connectorId,
      orgId,
      {},
      req?.headers,
      req?.query,
    );
    if (result && typeof result === 'object' && result.challenge) {
      return result.challenge;
    }
    return result;
  }

  @Public()
  @Post('inbound/:connectorId')
  async receiveInbound(
    @Param('connectorId') connectorId: string,
    @Body() body: any,
    @Query('orgId') queryOrgId?: string,
    @Req() req?: any,
  ) {
    let orgId = queryOrgId;
    const [c] = await this.sql<any[]>`
      SELECT org_id, provider_key FROM connectors WHERE id = ${connectorId}
    `;
    if (!orgId) {
      orgId = c?.org_id;
    }
    if (!orgId) {
      return { success: false, error: 'Connector or organization not found' };
    }

    if (c?.provider_key === 'whatsapp_cloud' || c?.provider_key === 'msg91' || c?.provider_key === 'twilio') {
      return this.messagingService.processInbound(connectorId, orgId, body, req?.headers, req?.query);
    }

    const message = await this.emailService.processInbound(orgId, {
      ...body,
      connectorId,
    });
    return { success: true, messageId: message.id, threadId: message.threadId, recordId: message.recordId };
  }

  @Public()
  @Post('inbound/:connectorId/bounce')
  async receiveBounce(
    @Param('connectorId') connectorId: string,
    @Body() body: BounceEventInput,
    @Query('orgId') queryOrgId?: string,
  ) {
    let orgId = queryOrgId;
    if (!orgId) {
      const [c] = await this.sql<any[]>`
        SELECT org_id FROM connectors WHERE id = ${connectorId}
      `;
      orgId = c?.org_id;
    }
    if (!orgId) {
      return { success: false, error: 'Connector or organization not found' };
    }

    return this.emailService.processBounce(orgId, {
      ...body,
      connectorId,
    });
  }
}
