import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { RolesService, CreateRoleDto, UpdateRoleDto } from './roles.service';
import { CurrentOrg } from '../common/decorators';

@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  async list(@CurrentOrg() orgId: string) {
    return this.rolesService.list(orgId);
  }

  @Post()
  async create(@CurrentOrg() orgId: string, @Body() body: CreateRoleDto) {
    return this.rolesService.create(orgId, body);
  }

  @Get(':id')
  async get(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.rolesService.getById(orgId, id);
  }

  @Patch(':id')
  async update(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Body() body: UpdateRoleDto
  ) {
    return this.rolesService.update(orgId, id, body);
  }

  @Delete(':id')
  async delete(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.rolesService.delete(orgId, id);
  }
}
