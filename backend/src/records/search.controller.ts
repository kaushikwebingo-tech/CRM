import { Controller, Get, Query } from '@nestjs/common';
import { RecordsService } from './records.service';
import { CurrentOrg, CurrentUser } from '../common/decorators';
import { CurrentUserPayload } from './records.service';

@Controller('search')
export class SearchController {
  constructor(private readonly recordsService: RecordsService) {}

  @Get()
  async search(
    @CurrentOrg() orgId: string,
    @Query('q') query: string,
    @CurrentUser() currentUser: CurrentUserPayload,
    @Query('limit') limit?: number
  ) {
    return this.recordsService.searchGlobal(orgId, query, limit, currentUser);
  }
}
