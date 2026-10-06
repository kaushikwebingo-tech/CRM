import { Module, Global } from '@nestjs/common';
import Redis from 'ioredis';
import { AuthService } from './auth.service';
import { SessionService, REDIS } from './session.service';
import { AuthController } from './auth.controller';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: REDIS,
      useFactory: () => {
        return new Redis(process.env.REDIS_URL as string);
      },
    },
    AuthService,
    SessionService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
  exports: [AuthService, SessionService, REDIS],
})
export class AuthModule {}
