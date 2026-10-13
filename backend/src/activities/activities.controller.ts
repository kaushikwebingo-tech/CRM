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
import { CurrentOrg, CurrentUser } from '../common/decorators';
import { ActivitiesService } from './activities.service';
import {
  CreateActivityDto,
  UpdateActivityDto,
} from './activities.types';

@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Get()
  async list(
    @CurrentOrg() orgId: string,
    @Query('relatedToId') relatedToId?: string,
    @Query('activityType') activityType?: string,
    @Query('ownerId') ownerId?: string,
    @Query('stageId') stageId?: string,
    @Query('limit') limit?: string,
  ) {
    const maxItems = limit ? parseInt(limit, 10) : 50;
    return this.activitiesService.list(orgId, {
      relatedToId,
      activityType,
      ownerId,
      stageId,
      limit: maxItems,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentOrg() orgId: string,
    @CurrentUser() user: any,
    @Body() body: CreateActivityDto,
  ) {
    return this.activitiesService.create(orgId, body, user?.id);
  }

  @Patch(':id')
  async update(
    @CurrentOrg() orgId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: UpdateActivityDto,
  ) {
    return this.activitiesService.update(orgId, id, body, user?.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
  ) {
    await this.activitiesService.delete(orgId, id);
  }
}
