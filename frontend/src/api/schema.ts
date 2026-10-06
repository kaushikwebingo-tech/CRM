import { api } from '@/api/client';

export interface FieldDef {
  key: string;
  label: string;
  type: string;
  config: Record<string, unknown>;
  isRequired: boolean;
  isUnique: boolean;
  isSystem: boolean;
  helpText: string | null;
  section: string;
  position: number;
}

export interface StageDef {
  id: string;
  key: string;
  label: string;
  color: string | null;
  type: 'open' | 'won' | 'lost';
  probability: number | null;
  position: number;
}

export interface PipelineDef {
  id: string;
  name: string;
  isDefault: boolean;
  stages: StageDef[];
}

export interface ModuleDef {
  id: string;
  key: string;
  labelSingular: string;
  labelPlural: string;
  icon: string | null;
  color: string | null;
  hasPipeline: boolean;
  nameFieldLabel: string;
  position: number;
  fields: FieldDef[];
  pipelines: PipelineDef[];
}

export interface SchemaBundle {
  modules: ModuleDef[];
  schemaVersion: number;
}

export function fetchSchema(): Promise<SchemaBundle> {
  return api.get<SchemaBundle>('/api/schema');
}
