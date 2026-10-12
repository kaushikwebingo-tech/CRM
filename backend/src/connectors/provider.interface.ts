import { z } from 'zod';

export type ProviderCategory = 'email' | 'messaging' | 'telephony' | 'calendar' | 'payment' | 'generic';

export interface ProviderManifest<TConfig = any, TCreds = any> {
  key: string;
  label: string;
  category: ProviderCategory;
  icon: string;
  auth: {
    type: 'api_key' | 'basic' | 'oauth2' | 'none';
    scopes?: string[];
    authorizeUrl?: string;
    tokenUrl?: string;
  };
  configSchema: z.ZodType<TConfig, any, any>;
  credentialSchema: z.ZodType<TCreds, any, any>;
  capabilities: string[];
  rateLimit: {
    perSecond: number;
    perDay?: number;
  };
  healthCheck(ctx: { config: TConfig; credentials: TCreds }): Promise<{ ok: boolean; detail?: string }>;
  inboundVerify?(req: any): boolean;
  inboundParse?(req: any): any[];
}

export interface ConnectorModel {
  id: string;
  orgId: string;
  providerKey: string;
  name: string;
  credentials?: string;
  config: Record<string, any>;
  isActive: boolean;
  createdAt: string;
}
