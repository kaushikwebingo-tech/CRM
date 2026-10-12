import { Module } from '@nestjs/common';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { OutboxWorkerService } from './outbox-worker.service';
import { GraphRunnerService } from './graph-runner.service';
import { WebhookActionHandler } from './actions/webhook.action';

@Module({
  controllers: [AutomationsController],
  providers: [
    AutomationsService,
    OutboxWorkerService,
    GraphRunnerService,
    WebhookActionHandler,
  ],
  exports: [AutomationsService, OutboxWorkerService, GraphRunnerService],
})
export class AutomationsModule {}
