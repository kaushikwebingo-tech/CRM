import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SessionService } from './session.service';
import { AuthService } from './auth.service';
import { Request } from 'express';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

interface AuthenticatedRequest extends Request {
  user?: any;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessionService: SessionService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const sessionId = request.signedCookies['crm.sid'];
    if (!sessionId) {
      throw new UnauthorizedException();
    }

    const session = await this.sessionService.getSession(sessionId);
    if (!session) {
      throw new UnauthorizedException();
    }

    const user = await this.authService.getUserById(session.userId);
    if (!user) {
      throw new UnauthorizedException();
    }
    // A user deactivated after signing in kept a valid session for up to
    // thirty days, because nothing rechecked is_active on the way through.
    if (user.isActive === false) {
      await this.sessionService.destroyUserSessions(session.userId);
      throw new UnauthorizedException();
    }

    await this.sessionService.touchSession(sessionId);
    request.user = user;
    return true;
  }
}
