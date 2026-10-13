import { Module } from '@nestjs/common';
import { MetadataModule } from '../metadata/metadata.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RoutingModule } from '../routing/routing.module';
import { DedupService } from './dedup.service';
import { AssignmentService } from './assignment.service';
import { CaptureService } from './capture.service';
import { CaptureController } from './capture.controller';

@Module({
  imports: [MetadataModule, NotificationsModule, RoutingModule],
  controllers: [CaptureController],
  providers: [DedupService, AssignmentService, CaptureService],
  exports: [CaptureService, DedupService, AssignmentService],
})
export class CaptureModule {}
