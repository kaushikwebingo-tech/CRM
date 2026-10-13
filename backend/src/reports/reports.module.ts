import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/connection';
import { MetadataModule } from '../metadata/metadata.module';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';

@Module({
  imports: [DatabaseModule, MetadataModule],
  providers: [ReportsService],
  controllers: [ReportsController],
  exports: [ReportsService],
})
export class ReportsModule {}
