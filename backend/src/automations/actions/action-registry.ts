import { ActionHandler } from '../automations.types';
import { WebhookActionHandler } from './webhook.action';
import { updateFieldAction } from './update-field.action';
import { assignOwnerAction } from './assign-owner.action';
import { changeStageAction } from './change-stage.action';
import { createRecordAction } from './create-record.action';

const registry = new Map<string, ActionHandler>();

const webhookHandler = new WebhookActionHandler();
registry.set(webhookHandler.key, webhookHandler);
registry.set(updateFieldAction.key, updateFieldAction);
registry.set(assignOwnerAction.key, assignOwnerAction);
registry.set(changeStageAction.key, changeStageAction);
registry.set(createRecordAction.key, createRecordAction);

export function getActionHandler(key: string): ActionHandler | undefined {
  return registry.get(key);
}

export function getAllActionHandlers(): ActionHandler[] {
  return Array.from(registry.values());
}
