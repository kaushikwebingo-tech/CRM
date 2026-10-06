import { Module } from '@nestjs/common';
import { RecordsService } from './records.service';
import { RecordsController } from './records.controller';
import { MetadataModule } from '../metadata/metadata.module';

import { ModuleActionsController } from './module-actions.controller';

@Module({
  imports: [MetadataModule],
  controllers: [RecordsController, ModuleActionsController],
  providers: [RecordsService],
  exports: [RecordsService],
})
export class RecordsModule {}
