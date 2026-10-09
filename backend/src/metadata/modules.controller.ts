import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { ModulesService } from './modules.service';
import { CurrentOrg } from '../common/decorators';
import { z } from 'zod';
import { RequireAdmin } from '../auth/permissions.guard';

const createSchema = z.object({
  key: z.string(),
  labelSingular: z.string(),
  labelPlural: z.string(),
  icon: z.string().optional(),
  color: z.string().optional(),
  hasPipeline: z.boolean().optional(),
  nameFieldLabel: z.string().optional(),
});

const updateSchema = createSchema.partial();

@Controller('modules')
export class ModulesController {
  constructor(private readonly modulesService: ModulesService) {}

  @Get()
  async list(@CurrentOrg() orgId: string) {
    return this.modulesService.list(orgId);
  }

  @RequireAdmin('manageModules', 'create a module')
  @Post()
  async create(@CurrentOrg() orgId: string, @Body() body: any) {
    const data = createSchema.parse(body);
    return this.modulesService.create(orgId, data);
  }

  @RequireAdmin('manageModules', 'change a module')
  @Patch(':key')
  async update(@CurrentOrg() orgId: string, @Param('key') key: string, @Body() body: any) {
    const data = updateSchema.parse(body);
    return this.modulesService.update(orgId, key, data);
  }

  @RequireAdmin('manageModules', 'delete a module')
  @Delete(':key')
  async remove(@CurrentOrg() orgId: string, @Param('key') key: string) {
    await this.modulesService.softDelete(orgId, key);
    return { success: true };
  }
}
