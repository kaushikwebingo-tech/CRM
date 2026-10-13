import { api } from './client';

export interface MessageItem {
  id: string;
  orgId: string;
  recordId: string | null;
  threadId: string;
  channel: 'email' | 'whatsapp' | 'sms';
  direction: 'inbound' | 'outbound';
  connectorId: string | null;
  fromAddress: string;
  toAddress: string;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'bounced' | 'suppressed';
  statusDetail: string | null;
  createdAt: string;
}

export interface SendEmailPayload {
  recordId?: string;
  connectorId?: string;
  templateId?: string;
  toEmail: string;
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
}

export function fetchRecordMessages(recordId: string): Promise<MessageItem[]> {
  return api.get<MessageItem[]>(`/api/email/records/${recordId}`);
}

export function sendRecordEmail(payload: SendEmailPayload): Promise<MessageItem> {
  return api.post<MessageItem>('/api/email/send', payload);
}

export interface SuppressionItem {
  id: string;
  orgId: string;
  address: string;
  channel: string;
  reason: string;
  detail: string | null;
  createdAt: string;
}

export function fetchSuppressions(channel: string = 'email'): Promise<SuppressionItem[]> {
  return api.get<SuppressionItem[]>(`/api/email/suppressions?channel=${channel}`);
}

export function deleteSuppression(id: string): Promise<void> {
  return api.del(`/api/email/suppressions/${id}`);
}
