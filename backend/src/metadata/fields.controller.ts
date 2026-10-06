import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { FieldsService } from './fields.service';
import { ModulesService } from './modules.service';
import { CurrentOrg } from '../common/decorators';
import { z } from 'zod';

const createSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.string(),
  config: z.any().optional(),
  isRequired: z.boolean().optional(),
  isUnique: z.boolean().optional(),
  isIndexed: z.boolean().optional(),
  isSearchable: z.boolean().optional(),
  defaultValue: z.any().optional(),
  helpText: z.string().optional(),
  section: z.string().optional(),
  position: z.number().optional(),
});

const updateSchema = createSchema.partial();
const reorderSchema = z.object({
  orderedKeys: z.array(z.string()),
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

  @Post()
  async create(@CurrentOrg() orgId: string, @Param('moduleKey') moduleKey: string, @Body() body: any) {
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const data = createSchema.parse(body);
    return this.fieldsService.create(orgId, mod.id, data);
  }

  @Patch(':fieldKey')
  async update(@CurrentOrg() orgId: string, @Param('moduleKey') moduleKey: string, @Param('fieldKey') fieldKey: string, @Body() body: any) {
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const data = updateSchema.parse(body);
    return this.fieldsService.update(orgId, mod.id, fieldKey, data);
  }

  @Delete(':fieldKey')
  async remove(@CurrentOrg() orgId: string, @Param('moduleKey') moduleKey: string, @Param('fieldKey') fieldKey: string) {
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    await this.fieldsService.softDelete(orgId, mod.id, fieldKey);
    return { success: true };
  }

  @Post('reorder')
  async reorder(@CurrentOrg() orgId: string, @Param('moduleKey') moduleKey: string, @Body() body: any) {
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    const data = reorderSchema.parse(body);
    await this.fieldsService.reorder(orgId, mod.id, data.orderedKeys);
    return { success: true };
  }
}
