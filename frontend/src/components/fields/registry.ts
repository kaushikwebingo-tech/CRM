import { FieldComponentSet } from './types';
import { TextInput, LongTextInput, TextCell } from './text-field';
import { NumberInput, NumberCell, PercentCell } from './number-field';
import { CurrencyInput, CurrencyCell } from './currency-field';
import { SelectInput, SelectCell, MultiSelectInput, MultiSelectCell } from './select-field';
import { DateInput, DateCell, DateTimeInput, DateTimeCell } from './date-field';
import { BooleanInput, BooleanCell } from './boolean-field';
import { EmailInput, EmailCell, PhoneInput, PhoneCell, UrlInput, UrlCell } from './link-field';
import { UserInput, UserCell, LookupInput, LookupCell, AutoNumberInput, AutoNumberCell, TagsInput, TagsCell } from './lookup-field';

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
  file: { Input: TextInput, Cell: TextCell },
};

export function getFieldComponent(type: string): FieldComponentSet {
  return FIELD_COMPONENTS[type] || { Input: TextInput, Cell: TextCell };
}
