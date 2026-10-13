import { Module, forwardRef } from '@nestjs/common';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';
import { SuppressionService } from './suppression.service';
import { TemplatesModule } from '../templates/templates.module';
import { ConnectorsModule } from '../connectors/connectors.module';
import { MessagingModule } from '../messaging/messaging.module';

@Module({
  imports: [TemplatesModule, ConnectorsModule, forwardRef(() => MessagingModule)],
  controllers: [EmailController],
  providers: [EmailService, SuppressionService],
  exports: [EmailService, SuppressionService],
})
export class EmailModule {}
