import { Module, Global } from '@nestjs/common';
import Redis from 'ioredis';
import { AuthService } from './auth.service';
import { SessionService, REDIS } from './session.service';
import { AuthController } from './auth.controller';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AuditService } from '../metadata/audit.service';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard';

@Global()
@Module({
  controllers: [AuthController, RolesController, UsersController],
  providers: [
    {
      provide: REDIS,
      useFactory: () => {
        return new Redis(process.env.REDIS_URL as string);
      },
    },
    AuthService,
    SessionService,
    RolesService,
    UsersService,
    AuditService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
  exports: [AuthService, SessionService, RolesService, UsersService, REDIS],
})
export class AuthModule {}
