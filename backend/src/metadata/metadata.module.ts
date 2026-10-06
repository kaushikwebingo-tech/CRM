import { Module } from '@nestjs/common';
import { ModulesService } from './modules.service';
import { FieldsService } from './fields.service';
import { PipelinesService } from './pipelines.service';
import { ViewsService } from './views.service';
import { SchemaCompiler } from './schema-compiler';
import { ModulesController } from './modules.controller';
import { FieldsController } from './fields.controller';
import { PipelinesController } from './pipelines.controller';
import { ViewsController } from './views.controller';
import { SchemaController } from './schema.controller';

@Module({
  controllers: [
    ModulesController,
    FieldsController,
    PipelinesController,
    ViewsController,
    SchemaController,
  ],
  providers: [
    ModulesService,
    FieldsService,
    PipelinesService,
    ViewsService,
    SchemaCompiler,
  ],
  exports: [
    ModulesService,
    FieldsService,
    PipelinesService,
    ViewsService,
    SchemaCompiler,
  ],
})
export class MetadataModule {}
