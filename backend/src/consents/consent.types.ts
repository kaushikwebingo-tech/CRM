export type ConsentChannel = 'email' | 'whatsapp' | 'sms' | 'call';
export type ConsentPurpose = 'transactional' | 'marketing' | 'utility';
export type ConsentStatus = 'granted' | 'withdrawn' | 'never_given';

export interface ConsentRecord {
  id: string;
  orgId: string;
  recordId: string;
  channel: ConsentChannel;
  purpose: ConsentPurpose;
  status: ConsentStatus;
  source: string;
  evidence: Record<string, unknown>;
  grantedAt: string | null;
  withdrawnAt: string | null;
  createdAt: string;
}

export interface RecordConsentDto {
  recordId: string;
  channel: ConsentChannel;
  purpose: ConsentPurpose;
  status: ConsentStatus;
  source: string;
  evidence?: Record<string, unknown>;
}

export interface WithdrawConsentDto {
  recordId: string;
  channel: ConsentChannel;
  purpose?: ConsentPurpose;
  reason?: string;
}

export interface ConsentCheckResult {
  allowed: boolean;
  reason?: string;
  consent?: ConsentRecord;
}
