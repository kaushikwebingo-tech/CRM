import { api } from './client';

export interface OutboundWhatsAppInput {
  connectorId?: string;
  recordId: string;
  toPhone?: string;
  templateId?: string;
  text?: string;
  purpose?: 'utility' | 'marketing' | 'transactional';
}

export interface OutboundSmsInput {
  connectorId?: string;
  recordId: string;
  toPhone?: string;
  templateId?: string;
  text?: string;
  dltTemplateId?: string;
  dltHeader?: string;
  purpose?: 'utility' | 'marketing' | 'transactional';
}

export interface WhatsAppSessionWindowResponse {
  isOpen: boolean;
  lastInboundAt: string | null;
  expiresAt: string | null;
  remainingMinutes: number;
}

export interface ConsentItem {
  id: string;
  orgId: string;
  recordId: string;
  channel: 'email' | 'whatsapp' | 'sms' | 'call';
  purpose: 'transactional' | 'marketing' | 'utility';
  status: 'granted' | 'withdrawn' | 'never_given';
  source: string;
  grantedAt: string | null;
  withdrawnAt: string | null;
}

export async function sendWhatsApp(data: OutboundWhatsAppInput) {
  return api.post<any>('/messaging/whatsapp/send', data);
}

export async function sendSms(data: OutboundSmsInput) {
  return api.post<any>('/messaging/sms/send', data);
}

export async function fetchSessionWindow(recordId: string): Promise<WhatsAppSessionWindowResponse> {
  return api.get<WhatsAppSessionWindowResponse>(`/messaging/records/${recordId}/session-window`);
}

export async function fetchRecordConsents(recordId: string): Promise<ConsentItem[]> {
  return api.get<ConsentItem[]>(`/consents/records/${recordId}`);
}

export async function grantConsent(data: {
  recordId: string;
  channel: 'email' | 'whatsapp' | 'sms' | 'call';
  purpose: 'transactional' | 'marketing' | 'utility';
  source?: string;
}) {
  return api.post<ConsentItem>('/consents', {
    ...data,
    status: 'granted',
    source: data.source || 'manual_ui',
  });
}

export async function withdrawConsent(data: {
  recordId: string;
  channel: 'email' | 'whatsapp' | 'sms' | 'call';
  purpose?: 'transactional' | 'marketing' | 'utility';
}) {
  return api.post<{ success: boolean; count: number }>('/consents/withdraw', data);
}
