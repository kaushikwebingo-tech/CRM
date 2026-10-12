import { ProviderManifest } from './provider.interface';
import { smtpProvider } from './providers/smtp.provider';
import { webhookOutProvider } from './providers/webhook-out.provider';

const registry = new Map<string, ProviderManifest>();

registry.set(smtpProvider.key, smtpProvider);
registry.set(webhookOutProvider.key, webhookOutProvider);

export function getProvider(key: string): ProviderManifest | undefined {
  return registry.get(key);
}

export function getAllProviders(): ProviderManifest[] {
  return Array.from(registry.values());
}

export function getProvidersByCapability(capability: string): ProviderManifest[] {
  return Array.from(registry.values()).filter((p) => p.capabilities.includes(capability));
}
