export type LeadSourceType =
  | 'web_form'
  | 'api'
  | 'email_parse'
  | 'ad_platform'
  | 'click_to_whatsapp'
  | 'csv';

export type OnDuplicateAction = 'merge' | 'create_anyway' | 'update_existing' | 'reject';

export interface AssignmentRuleConfig {
  strategy?: 'fixed' | 'round_robin' | 'load_balanced' | 'by_field_value';
  ownerId?: string;
  pool?: string[];
  fieldKey?: string;
  mapping?: Record<string, string>;
  fallbackOwnerId?: string;
}

export interface LeadSourceConfig {
  title?: string;
  description?: string;
  submitButtonText?: string;
  successMessage?: string;
  redirectUrl?: string;
  fields?: string[];
  theme?: {
    primaryColor?: string;
    backgroundColor?: string;
  };
  allowedOrigins?: string[];
  rateLimitPerMinute?: number;
}

export interface CreateLeadSourceDto {
  name: string;
  type?: LeadSourceType;
  targetModuleKey?: string;
  fieldMapping?: Record<string, string>;
  defaults?: Record<string, unknown>;
  dedupeOn?: string[];
  onDuplicate?: OnDuplicateAction;
  assignTo?: AssignmentRuleConfig;
  config?: LeadSourceConfig;
}

export interface UpdateLeadSourceDto {
  name?: string;
  fieldMapping?: Record<string, string>;
  defaults?: Record<string, unknown>;
  dedupeOn?: string[];
  onDuplicate?: OnDuplicateAction;
  assignTo?: AssignmentRuleConfig;
  config?: LeadSourceConfig;
  isActive?: boolean;
}

export interface PublicFormDefinition {
  sourceId: string;
  name: string;
  title: string;
  description: string;
  submitButtonText: string;
  successMessage: string;
  redirectUrl?: string;
  theme?: {
    primaryColor?: string;
    backgroundColor?: string;
  };
  fields: Array<{
    key: string;
    label: string;
    type: string;
    isRequired: boolean;
    helpText?: string | null;
    config?: Record<string, unknown>;
  }>;
}

export interface FormSubmissionResult {
  success: boolean;
  recordId?: string;
  assignedOwnerId?: string;
  isDuplicate?: boolean;
  quarantined?: boolean;
  quarantineId?: string;
  message?: string;
  errors?: any[];
}

export interface QuarantineItem {
  id: string;
  orgId: string;
  sourceId: string | null;
  sourceType: string;
  rawPayload: Record<string, unknown>;
  errorReason: string;
  errorDetails: Record<string, unknown>;
  status: 'quarantined' | 'replayed' | 'discarded';
  replayedRecordId: string | null;
  createdAt: string;
  replayedAt: string | null;
}
