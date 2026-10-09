import { Module } from '@nestjs/common';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule } from './db/connection';
import { AuthModule } from './auth/auth.module';
import { MetadataModule } from './metadata/metadata.module';
import { RecordsModule } from './records/records.module';
import { FilesModule } from './files/files.module';
import { AutomationsModule } from './automations/automations.module';
import { AuthGuard } from './auth/auth.guard';
import { AppErrorFilter } from './common/errors';
import { ResponseInterceptor, IdempotencyInterceptor } from './common/interceptors';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    MetadataModule,
    RecordsModule,
    FilesModule,
    AutomationsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_FILTER,
      useClass: AppErrorFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: IdempotencyInterceptor,
    },
  ],
})
export class AppModule {}
