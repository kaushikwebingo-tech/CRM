import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CurrentOrg, CurrentUser } from '../common/decorators';
import { NotificationsService } from './notifications.service';
import { RegisterDeviceTokenDto } from './notifications.types';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async list(
    @CurrentOrg() orgId: string,
    @CurrentUser() user: any,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('limit') limit?: string,
  ) {
    const isUnread = unreadOnly === 'true' || unreadOnly === '1';
    const maxItems = limit ? parseInt(limit, 10) : 50;
    return this.notificationsService.listForUser(orgId, user.id, isUnread, maxItems);
  }

  @Patch(':id/read')
  async markAsRead(
    @CurrentOrg() orgId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.notificationsService.markAsRead(orgId, user.id, id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllAsRead(
    @CurrentOrg() orgId: string,
    @CurrentUser() user: any,
  ) {
    return this.notificationsService.markAllAsRead(orgId, user.id);
  }

  @Post('device-token')
  @HttpCode(HttpStatus.OK)
  async registerDeviceToken(
    @CurrentOrg() orgId: string,
    @CurrentUser() user: any,
    @Body() body: RegisterDeviceTokenDto,
  ) {
    return this.notificationsService.registerDeviceToken(orgId, user.id, body);
  }
}
