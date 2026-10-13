export type ReportType =
  | 'funnel'
  | 'kpi'
  | 'breakdown'
  | 'time_series'
  | 'leaderboard'
  | 'matrix';

export type AggregateType =
  | 'count'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'count_distinct';

export interface GroupByConfig {
  fieldKey: string;
  bucket?: 'day' | 'week' | 'month' | 'quarter' | 'year';
  limit?: number;
}

export interface MetricConfig {
  aggregate?: AggregateType;
  fieldKey?: string | null;
  pipelineId?: string | null;
  filter?: Record<string, unknown> | null;
  groupBy?: GroupByConfig[];
  timeField?: string;
  comparison?: 'none' | 'previous_period' | 'previous_year';
  format?: {
    type: 'number' | 'currency' | 'percent' | 'duration';
    decimals: number;
  };
}

export interface CreateReportDto {
  moduleKey: string;
  name: string;
  type: ReportType;
  config: MetricConfig;
}

export interface UpdateReportDto {
  name?: string;
  type?: ReportType;
  config?: MetricConfig;
}

export interface FunnelStageItem {
  stageId: string;
  stageKey: string;
  stageLabel: string;
  color: string | null;
  position: number;
  count: number;
  conversionRate: number;
  dropoffRate: number;
}

export interface FunnelReportResult {
  reportId: string;
  reportName: string;
  moduleKey: string;
  pipelineId?: string;
  totalRecords: number;
  stages: FunnelStageItem[];
}

export interface DrillThroughItem {
  id: string;
  displayName: string;
  stageId: string | null;
  ownerId: string | null;
  createdAt: string;
  data: Record<string, unknown>;
}

export interface CreateDashboardDto {
  name: string;
  layout?: any[];
  widgets?: any[];
  isDefault?: boolean;
}

export interface UpdateDashboardDto {
  name?: string;
  layout?: any[];
  widgets?: any[];
  isDefault?: boolean;
}
