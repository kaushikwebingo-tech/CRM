import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { ViewsService } from './views.service';
import { ModulesService } from './modules.service';
import { CurrentOrg, CurrentUser } from '../common/decorators';
import { z } from 'zod';

const createSchema = z.object({
  name: z.string(),
  type: z.string().optional(),
  config: z.any().optional(),
  isDefault: z.boolean().optional(),
  position: z.number().optional(),
});
const updateSchema = createSchema.partial();

@Controller('modules/:moduleKey/views')
export class ViewsController {
  constructor(
    private readonly viewsService: ViewsService,
    private readonly modulesService: ModulesService,
  ) {}

  @Get()
  async list(@CurrentOrg() orgId: string, @Param('moduleKey') moduleKey: string) {
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    return this.viewsService.list(orgId, mod.id);
  }

  @Post()
  async create(@CurrentOrg() orgId: string, @CurrentUser() user: any, @Param('moduleKey') moduleKey: string, @Body() body: any) {
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const data = createSchema.parse(body);
    return this.viewsService.create(orgId, mod.id, { ...data, ownerId: user.id });
  }

  @Patch(':id')
  async update(@CurrentOrg() orgId: string, @Param('id') id: string, @Body() body: any) {
    const data = updateSchema.parse(body);
    return this.viewsService.update(orgId, id, data);
  }

  @Delete(':id')
  async remove(@CurrentOrg() orgId: string, @Param('id') id: string) {
    await this.viewsService.softDelete(orgId, id);
    return { success: true };
  }
}
