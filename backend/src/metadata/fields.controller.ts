import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { FieldsService } from './fields.service';
import { ModulesService } from './modules.service';
import { CurrentOrg, CurrentUser } from '../common/decorators';
import { z } from 'zod';
import { RequireAdmin } from '../auth/permissions.guard';


const reorderSchema = z.object({
  orderedKeys: z.array(z.string()).max(500),
});

@Controller('modules/:moduleKey/fields')
export class FieldsController {
  constructor(
    private readonly fieldsService: FieldsService,
    private readonly modulesService: ModulesService,
  ) {}

  @Get()
  async list(@CurrentOrg() orgId: string, @Param('moduleKey') moduleKey: string) {
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    return this.fieldsService.list(orgId, mod.id);
  }

  @RequireAdmin('manageModules', 'add a field')
  @Post()
  async create(
    @CurrentOrg() orgId: string,
    @Param('moduleKey') moduleKey: string,
    @Body() body: unknown,
    @CurrentUser() user: { id: string },
  ) {
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    return this.fieldsService.create(orgId, mod.id, body, user?.id);
  }

  @RequireAdmin('manageModules', 'change a field')
  @Patch(':fieldKey')
  async update(
    @CurrentOrg() orgId: string,
    @Param('moduleKey') moduleKey: string,
    @Param('fieldKey') fieldKey: string,
    @Body() body: unknown,
    @CurrentUser() user: { id: string },
  ) {
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    return this.fieldsService.update(orgId, mod.id, fieldKey, body, user?.id);
  }

  @RequireAdmin('manageModules', 'delete a field')
  @Delete(':fieldKey')
  async remove(
    @CurrentOrg() orgId: string,
    @Param('moduleKey') moduleKey: string,
    @Param('fieldKey') fieldKey: string,
    @CurrentUser() user: { id: string },
  ) {
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    await this.fieldsService.softDelete(orgId, mod.id, fieldKey, user?.id);
    return { success: true };
  }

  @RequireAdmin('manageModules', 'reorder fields')
  @Post('reorder')
  async reorder(
    @CurrentOrg() orgId: string,
    @Param('moduleKey') moduleKey: string,
    @Body() body: any,
    @CurrentUser() user: { id: string },
  ) {
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const data = reorderSchema.parse(body);
    await this.fieldsService.reorder(orgId, mod.id, data.orderedKeys, user?.id);
    return { success: true };
  }
}
