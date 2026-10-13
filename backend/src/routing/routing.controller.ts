import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CurrentOrg } from '../common/decorators';
import { RoutingService } from './routing.service';
import { CalendarService } from './calendar.service';
import { SlaService } from './sla.service';
import {
  CreateRuleDto,
  UpdateRuleDto,
  OrgCalendarDto,
  RuleKind,
} from './routing.types';

@Controller('routing')
export class RoutingController {
  constructor(
    private readonly routingService: RoutingService,
    private readonly calendarService: CalendarService,
    private readonly slaService: SlaService,
  ) {}

  @Get('rules')
  async listRules(
    @CurrentOrg() orgId: string,
    @Query('moduleId') moduleId?: string,
    @Query('kind') kind?: RuleKind,
  ) {
    return this.routingService.listRules(orgId, moduleId, kind);
  }

  @Post('rules')
  @HttpCode(HttpStatus.CREATED)
  async createRule(
    @CurrentOrg() orgId: string,
    @Body() body: CreateRuleDto,
  ) {
    return this.routingService.createRule(orgId, body);
  }

  @Get('rules/:id')
  async getRule(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
  ) {
    return this.routingService.getRule(orgId, id);
  }

  @Patch('rules/:id')
  async updateRule(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Body() body: UpdateRuleDto,
  ) {
    return this.routingService.updateRule(orgId, id, body);
  }

  @Delete('rules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRule(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
  ) {
    await this.routingService.deleteRule(orgId, id);
  }

  @Get('calendar')
  async getCalendar(@CurrentOrg() orgId: string) {
    return this.calendarService.getCalendar(orgId);
  }

  @Patch('calendar')
  async updateCalendar(
    @CurrentOrg() orgId: string,
    @Body() body: OrgCalendarDto,
  ) {
    return this.calendarService.updateCalendar(orgId, body);
  }

  @Post('slas/evaluate')
  async evaluateSlas(
    @CurrentOrg() orgId: string,
    @Body() body: { simulatedDate?: string },
  ) {
    const simDate = body.simulatedDate ? new Date(body.simulatedDate) : undefined;
    return this.slaService.evaluateSlas(orgId, simDate);
  }

  @Get('slas/record/:recordId')
  async getRecordSlas(
    @CurrentOrg() orgId: string,
    @Param('recordId') recordId: string,
  ) {
    return this.slaService.getSlasForRecord(orgId, recordId);
  }

  @Post('assignments/evaluate')
  async evaluateAssignment(
    @CurrentOrg() orgId: string,
    @Body()
    body: {
      moduleId: string;
      recordData: Record<string, unknown>;
      currentOwnerId?: string | null;
      evaluationDate?: string;
    },
  ) {
    const evalDate = body.evaluationDate ? new Date(body.evaluationDate) : undefined;
    return this.routingService.evaluateAssignment(
      orgId,
      body.moduleId,
      body.recordData || {},
      body.currentOwnerId,
      evalDate,
    );
  }

  @Post('slas/attach')
  async attachSla(
    @CurrentOrg() orgId: string,
    @Body() body: { moduleId: string; record: any },
  ) {
    await this.slaService.attachSlaToRecord(orgId, body.moduleId, body.record);
    return { success: true };
  }
}
