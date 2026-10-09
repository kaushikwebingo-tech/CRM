import { Controller, Post } from '@nestjs/common';
import { IndexPromotionService } from './index-promotion.service';
import { CurrentOrg } from '../common/decorators';
import { RequireAdmin } from '../auth/permissions.guard';

@Controller('schema/indexes')
export class IndexPromotionController {
  constructor(private readonly promotion: IndexPromotionService) {}

 
  @RequireAdmin('manageModules', 'manage indexes')
  @Post('reconcile')
  async reconcile(@CurrentOrg() orgId: string) {
    return this.promotion.reconcile(orgId);
  }
}
