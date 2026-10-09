import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { RolesService, CreateRoleDto, UpdateRoleDto } from './roles.service';
import { CurrentOrg } from '../common/decorators';
import { RequireAdmin } from './permissions.guard';

@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  async list(@CurrentOrg() orgId: string) {
    return this.rolesService.list(orgId);
  }

  @RequireAdmin('manageUsers', 'create a role')
  @Post()
  async create(@CurrentOrg() orgId: string, @Body() body: CreateRoleDto) {
    return this.rolesService.create(orgId, body);
  }

  @Get(':id')
  async get(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.rolesService.getById(orgId, id);
  }

  @RequireAdmin('manageUsers', 'change a role')
  @Patch(':id')
  async update(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Body() body: UpdateRoleDto
  ) {
    return this.rolesService.update(orgId, id, body);
  }

  @RequireAdmin('manageUsers', 'delete a role')
  @Delete(':id')
  async delete(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.rolesService.delete(orgId, id);
  }
}
