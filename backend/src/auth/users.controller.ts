import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { CurrentOrg, CurrentUser } from '../common/decorators';
import { UsersService } from './users.service';
import { RequireAdmin } from './permissions.guard';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async list(@CurrentOrg() orgId: string) {
    return this.usersService.list(orgId);
  }

  @RequireAdmin('manageUsers', 'create a user')
  @Post()
  async create(
    @CurrentOrg() orgId: string,
    @Body() body: unknown,
    @CurrentUser() actor: { id: string },
  ) {
    return this.usersService.create(orgId, body, actor?.id);
  }

  @RequireAdmin('manageUsers', 'change a user')
  @Patch(':id')
  async update(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() actor: { id: string },
  ) {
    return this.usersService.update(orgId, id, body, actor?.id);
  }

  @RequireAdmin('manageUsers', 'change a user role')
  @Patch(':id/role')
  async assignRole(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Body() body: { roleId?: string | null },
    @CurrentUser() actor: { id: string },
  ) {
    return this.usersService.update(orgId, id, { roleId: body?.roleId ?? null }, actor?.id);
  }

  @RequireAdmin('manageUsers', 'deactivate a user')
  @Delete(':id')
  async deactivate(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @CurrentUser() actor: { id: string },
  ) {
    return this.usersService.deactivate(orgId, id, actor?.id);
  }
}
