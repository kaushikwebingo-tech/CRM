import { FieldTypeDef } from './types';
import { textField } from './definitions/text';
import { longTextField } from './definitions/long-text';
import { numberField } from './definitions/number';
import { currencyField } from './definitions/currency';
import { percentField } from './definitions/percent';
import { dateField } from './definitions/date';
import { datetimeField } from './definitions/datetime';
import { booleanField } from './definitions/boolean';
import { selectField } from './definitions/select';
import { multiSelectField } from './definitions/multi-select';
import { emailField } from './definitions/email';
import { phoneField } from './definitions/phone';
import { urlField } from './definitions/url';
import { userField } from './definitions/user';
import { lookupField } from './definitions/lookup';
import { fileField } from './definitions/file';
import { tagsField } from './definitions/tags';
import { autoNumberField } from './definitions/auto-number';

const registry = new Map<string, FieldTypeDef<any, any>>();

const register = (def: FieldTypeDef<any, any>) => {
  registry.set(def.key, def);
};

register(textField);
register(longTextField);
register(numberField);
register(currencyField);
register(percentField);
register(dateField);
register(datetimeField);
register(booleanField);
register(selectField);
register(multiSelectField);
register(emailField);
register(phoneField);
register(urlField);
register(userField);
register(lookupField);
register(fileField);
register(tagsField);
register(autoNumberField);

export function getFieldType(key: string): FieldTypeDef<any, any> {
  const def = registry.get(key);
  if (!def) {
    throw new Error(`Field type ${key} not found`);
  }
  return def;
}

export function getAllFieldTypes(): FieldTypeDef<any, any>[] {
  return Array.from(registry.values());
}
