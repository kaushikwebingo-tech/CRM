import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CurrentOrg } from '../common/decorators';
import {
  TemplatesService,
  CreateTemplateDto,
  UpdateTemplateDto,
  PreviewTemplateDto,
  TestSendTemplateDto,
} from './templates.service';
import { RequireAdmin } from '../auth/permissions.guard';

@Controller('templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  async list(@CurrentOrg() orgId: string, @Query('channel') channel?: string) {
    return this.templatesService.list(orgId, channel);
  }

  @RequireAdmin('manageTemplates', 'create a template')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentOrg() orgId: string, @Body() body: CreateTemplateDto) {
    return this.templatesService.create(orgId, body);
  }

  @Post('preview')
  async preview(@CurrentOrg() orgId: string, @Body() body: PreviewTemplateDto) {
    return this.templatesService.preview(orgId, body);
  }

  @RequireAdmin('manageTemplates', 'test-send a template')
  @Post('test-send')
  async testSend(@CurrentOrg() orgId: string, @Body() body: TestSendTemplateDto) {
    return this.templatesService.testSend(orgId, body);
  }

  @Get(':id')
  async get(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.templatesService.getById(orgId, id);
  }

  @RequireAdmin('manageTemplates', 'update a template')
  @Patch(':id')
  async update(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Body() body: UpdateTemplateDto,
  ) {
    return this.templatesService.update(orgId, id, body);
  }

  @RequireAdmin('manageTemplates', 'delete a template')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentOrg() orgId: string, @Param('id') id: string) {
    await this.templatesService.delete(orgId, id);
  }
}
