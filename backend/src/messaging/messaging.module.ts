import { Module, forwardRef } from '@nestjs/common';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { ConsentModule } from '../consents/consent.module';
import { EmailModule } from '../email/email.module';
import { TemplatesModule } from '../templates/templates.module';
import { ConnectorsModule } from '../connectors/connectors.module';
import { CredentialVault } from '../connectors/credential-vault';

@Module({
  imports: [ConsentModule, forwardRef(() => EmailModule), TemplatesModule, ConnectorsModule],
  controllers: [MessagingController],
  providers: [MessagingService, CredentialVault],
  exports: [MessagingService],
})
export class MessagingModule {}
