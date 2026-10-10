import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { ViewsService } from './views.service';
import { ModulesService } from './modules.service';
import { CurrentOrg, CurrentUser } from '../common/decorators';
import { adminPermission, parsePermissions } from '../auth/permissions';

interface SessionUser {
  id: string;
  role?: { permissions?: unknown };
}

function viewActor(user: SessionUser) {
  return {
    id: user?.id,
    canManageViews: adminPermission(parsePermissions(user?.role?.permissions)).manageViews,
  };
}

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
  async create(
    @CurrentOrg() orgId: string,
    @CurrentUser() user: SessionUser,
    @Param('moduleKey') moduleKey: string,
    @Body() body: unknown,
  ) {
    const mod = await this.modulesService.getByKey(orgId, moduleKey);
    return this.viewsService.create(orgId, mod.id, body, user?.id);
  }

  @Patch(':id')
  async update(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: SessionUser,
  ) {
    return this.viewsService.update(orgId, id, body, viewActor(user));
  }

  @Delete(':id')
  async remove(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
  ) {
    await this.viewsService.softDelete(orgId, id, viewActor(user));
    return { success: true };
  }
}
