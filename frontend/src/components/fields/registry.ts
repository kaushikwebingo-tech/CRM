import { FieldComponentSet } from './types';
import { TextInput, LongTextInput, TextCell } from './text-field';
import { NumberInput, NumberCell, PercentCell } from './number-field';
import { CurrencyInput, CurrencyCell } from './currency-field';
import { SelectInput, SelectCell, MultiSelectInput, MultiSelectCell } from './select-field';
import { DateInput, DateCell, DateTimeInput, DateTimeCell } from './date-field';
import { BooleanInput, BooleanCell } from './boolean-field';
import { EmailInput, EmailCell, PhoneInput, PhoneCell, UrlInput, UrlCell } from './link-field';
import { UserInput, UserCell, LookupInput, LookupCell, AutoNumberInput, AutoNumberCell, TagsInput, TagsCell } from './lookup-field';
import { FileInput, FileCell } from './file-field';

export const FIELD_COMPONENTS: Record<string, FieldComponentSet> = {
  text: { Input: TextInput, Cell: TextCell },
  long_text: { Input: LongTextInput, Cell: TextCell },
  number: { Input: NumberInput, Cell: NumberCell },
  currency: { Input: CurrencyInput, Cell: CurrencyCell },
  percent: { Input: NumberInput, Cell: PercentCell },
  date: { Input: DateInput, Cell: DateCell },
  datetime: { Input: DateTimeInput, Cell: DateTimeCell },
  boolean: { Input: BooleanInput, Cell: BooleanCell },
  select: { Input: SelectInput, Cell: SelectCell },
  multi_select: { Input: MultiSelectInput, Cell: MultiSelectCell },
  email: { Input: EmailInput, Cell: EmailCell },
  phone: { Input: PhoneInput, Cell: PhoneCell },
  url: { Input: UrlInput, Cell: UrlCell },
  user: { Input: UserInput, Cell: UserCell },
  lookup: { Input: LookupInput, Cell: LookupCell },
  tags: { Input: TagsInput, Cell: TagsCell },
  auto_number: { Input: AutoNumberInput, Cell: AutoNumberCell },
  // `file` used to fall back to TextInput, which overwrote the stored
  // attachment array with whatever text the box held.
  file: { Input: FileInput, Cell: FileCell },
};

/**
 * A type with no registry entry falls back to a text input rather than
 * throwing, so an unknown field type degrades to "editable as text" instead of
 * blanking the screen. `hasFieldComponent` lets a caller tell the difference.
 */
export function getFieldComponent(type: string): FieldComponentSet {
  return FIELD_COMPONENTS[type] || { Input: TextInput, Cell: TextCell };
}

export function hasFieldComponent(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(FIELD_COMPONENTS, type);
}
