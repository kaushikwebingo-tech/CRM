import { Controller, Get, Query } from '@nestjs/common';
import { RecordsService } from './records.service';
import { CurrentOrg } from '../common/decorators';

@Controller('search')
export class SearchController {
  constructor(private readonly recordsService: RecordsService) {}

  @Get()
  async search(
    @CurrentOrg() orgId: string,
    @Query('q') query: string,
    @Query('limit') limit?: number
  ) {
    const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 50);
    return this.recordsService.searchGlobal(orgId, query, limitNum);
  }
}
