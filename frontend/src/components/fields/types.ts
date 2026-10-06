import { ComponentType } from 'react';
import { FieldDef } from '@/api/schema';

export interface FieldInputProps {
  field: FieldDef;
  value: any;
  onChange: (val: any) => void;
  error?: string;
  disabled?: boolean;
}

export interface FieldCellProps {
  field: FieldDef;
  value: any;
  record: any;
}

export interface FieldComponentSet {
  Input: ComponentType<FieldInputProps>;
  Cell: ComponentType<FieldCellProps>;
}
