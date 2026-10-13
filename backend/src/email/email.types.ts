export type MessageChannel = 'email' | 'whatsapp' | 'sms';
export type MessageDirection = 'inbound' | 'outbound';
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'bounced' | 'suppressed';
export type SuppressionReason = 'hard_bounce' | 'complaint' | 'unsubscribe' | 'manual';

export interface MessageItem {
  id: string;
  orgId: string;
  recordId: string | null;
  threadId: string;
  channel: MessageChannel;
  direction: MessageDirection;
  connectorId: string | null;
  fromAddress: string;
  toAddress: string;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  attachments: Array<{
    name: string;
    size: number;
    mimeType: string;
    url: string;
  }>;
  templateId: string | null;
  providerMessageId: string | null;
  inReplyTo: string | null;
  status: MessageStatus;
  statusDetail: string | null;
  sentBy: string | null;
  automationRunId: number | null;
  createdAt: string;
}

export interface OutboundEmailDto {
  recordId?: string;
  connectorId?: string;
  templateId?: string;
  toEmail: string;
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  threadId?: string;
  inReplyTo?: string;
  sentBy?: string;
  automationRunId?: number;
  headers?: Record<string, string>;
}

export interface InboundEmailInput {
  connectorId?: string;
  from: string;
  to: string;
  subject?: string;
  text?: string;
  html?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  headers?: Record<string, string>;
  attachments?: Array<{
    name: string;
    size: number;
    mimeType: string;
    url: string;
  }>;
}

export interface BounceEventInput {
  connectorId?: string;
  email: string;
  bounceType: 'hard' | 'soft' | 'complaint';
  reason?: string;
  diagnosticCode?: string;
  messageId?: string;
}

export interface SuppressionItem {
  id: string;
  orgId: string;
  address: string;
  channel: MessageChannel;
  reason: SuppressionReason;
  detail: string | null;
  createdAt: string;
}
