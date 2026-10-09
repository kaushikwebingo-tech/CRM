import { ActionHandler } from '../automations.types';
import { WebhookActionHandler } from './webhook.action';

const registry = new Map<string, ActionHandler>();

const webhookHandler = new WebhookActionHandler();
registry.set(webhookHandler.key, webhookHandler);

export function getActionHandler(key: string): ActionHandler | undefined {
  return registry.get(key);
}

export function getAllActionHandlers(): ActionHandler[] {
  return Array.from(registry.values());
}
