import { ProviderManifest } from './provider.interface';
import { smtpProvider } from './providers/smtp.provider';
import { webhookOutProvider } from './providers/webhook-out.provider';
import { whatsappCloudProvider } from './providers/whatsapp-cloud.provider';
import { msg91Provider } from './providers/msg91.provider';
import { twilioProvider } from './providers/twilio.provider';

const registry = new Map<string, ProviderManifest>();

registry.set(smtpProvider.key, smtpProvider);
registry.set(webhookOutProvider.key, webhookOutProvider);
registry.set(whatsappCloudProvider.key, whatsappCloudProvider);
registry.set(msg91Provider.key, msg91Provider);
registry.set(twilioProvider.key, twilioProvider);

export function getProvider(key: string): ProviderManifest | undefined {
  return registry.get(key);
}

export function getAllProviders(): ProviderManifest[] {
  return Array.from(registry.values());
}

export function getProvidersByCapability(capability: string): ProviderManifest[] {
  return Array.from(registry.values()).filter((p) => p.capabilities.includes(capability));
}
