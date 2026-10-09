import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminPermission, assertAdmin, parsePermissions } from './permissions';
import { ForbiddenError } from '../common/errors';

export const REQUIRE_ADMIN_KEY = 'requireAdmin';


export const RequireAdmin = (capability: keyof AdminPermission, what: string) =>
  SetMetadata(REQUIRE_ADMIN_KEY, { capability, what });

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requirement = this.reflector.getAllAndOverride<{
      capability: keyof AdminPermission;
      what: string;
    }>(REQUIRE_ADMIN_KEY, [context.getHandler(), context.getClass()]);

    if (!requirement) return true;

    const request = context.switchToHttp().getRequest<{ user?: { role?: { permissions?: unknown } } }>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenError(`You do not have permission to ${requirement.what}`);
    }

    assertAdmin(parsePermissions(user.role?.permissions), requirement.capability, requirement.what);
    return true;
  }
}
