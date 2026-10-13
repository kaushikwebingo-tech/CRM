export interface OutboundWhatsAppDto {
  connectorId?: string;
  recordId: string;
  toPhone?: string;
  templateId?: string;
  text?: string;
  purpose?: 'utility' | 'marketing' | 'transactional';
  templateVariables?: Record<string, unknown>;
}

export interface OutboundSmsDto {
  connectorId?: string;
  recordId: string;
  toPhone?: string;
  templateId?: string;
  text?: string;
  dltTemplateId?: string;
  dltHeader?: string;
  purpose?: 'utility' | 'marketing' | 'transactional';
  templateVariables?: Record<string, unknown>;
}

export interface WhatsAppSessionWindow {
  isOpen: boolean;
  lastInboundAt: string | null;
  expiresAt: string | null;
  remainingMinutes: number;
}
