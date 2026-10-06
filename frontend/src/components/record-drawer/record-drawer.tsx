import { ModuleDef } from '@/api/schema';
import { RecordItem } from '@/api/records';
import { DynamicForm } from '@/components/dynamic-form/dynamic-form';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export interface RecordDrawerProps {
  module: ModuleDef;
  record: RecordItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (values: {
    display_name: string;
    stage_id?: string;
    owner_id?: string;
    data: Record<string, unknown>;
  }) => Promise<void>;
}

export function RecordDrawer({
  module,
  record,
  isOpen,
  onClose,
  onSave,
}: RecordDrawerProps): JSX.Element {
  const isEditing = Boolean(record);
  const title = isEditing
    ? `Edit ${module.labelSingular}: ${record?.display_name}`
    : `New ${module.labelSingular}`;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? `Update dynamic field values for this ${module.labelSingular.toLowerCase()}.`
              : `Fill in the details to create a new ${module.labelSingular.toLowerCase()}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          <DynamicForm
            module={module}
            initialValues={
              record
                ? {
                    display_name: record.display_name,
                    stage_id: record.stage_id,
                    owner_id: record.owner_id,
                    data: record.data,
                  }
                : undefined
            }
            onSubmit={onSave}
            onCancel={onClose}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
