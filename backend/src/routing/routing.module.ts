import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/connection';
import { NotificationsModule } from '../notifications/notifications.module';
import { CalendarService } from './calendar.service';
import { RoutingService } from './routing.service';
import { SlaService } from './sla.service';
import { RoutingController } from './routing.controller';

@Module({
  imports: [DatabaseModule, NotificationsModule],
  providers: [CalendarService, RoutingService, SlaService],
  controllers: [RoutingController],
  exports: [CalendarService, RoutingService, SlaService],
})
export class RoutingModule {}
