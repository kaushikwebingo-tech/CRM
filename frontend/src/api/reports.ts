import { api } from './client';

export type ReportType = 'funnel' | 'kpi' | 'breakdown' | 'time_series' | 'leaderboard' | 'matrix';

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

export interface ReportItem {
  id: string;
  orgId: string;
  moduleKey: string;
  name: string;
  type: ReportType;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardItem {
  id: string;
  orgId: string;
  name: string;
  layout: any[];
  widgets: any[];
  isDefault: boolean;
  createdAt: string;
}

export async function fetchReports(moduleKey?: string): Promise<ReportItem[]> {
  const qs = moduleKey ? `?moduleKey=${encodeURIComponent(moduleKey)}` : '';
  return api.get<ReportItem[]>(`/reports${qs}`);
}

export async function createReport(data: Partial<ReportItem>): Promise<ReportItem> {
  return api.post<ReportItem>('/reports', data);
}

export async function updateReport(id: string, data: Partial<ReportItem>): Promise<ReportItem> {
  return api.patch<ReportItem>(`/reports/${id}`, data);
}

export async function deleteReport(id: string): Promise<void> {
  return api.del<void>(`/reports/${id}`);
}

export async function runReport<T = any>(id: string, bypassCache = false): Promise<T> {
  const qs = bypassCache ? '?bypassCache=true' : '';
  return api.get<T>(`/reports/${id}/run${qs}`);
}

export async function drillThrough(id: string, bucketKey: string, limit = 50): Promise<DrillThroughItem[]> {
  const qs = `?bucketKey=${encodeURIComponent(bucketKey)}&limit=${limit}`;
  return api.get<DrillThroughItem[]>(`/reports/${id}/drillthrough${qs}`);
}

export async function fetchDashboards(): Promise<DashboardItem[]> {
  return api.get<DashboardItem[]>('/dashboards');
}

export async function createDashboard(data: Partial<DashboardItem>): Promise<DashboardItem> {
  return api.post<DashboardItem>('/dashboards', data);
}
