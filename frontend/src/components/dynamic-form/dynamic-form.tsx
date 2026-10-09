import { useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ModuleDef } from '@/api/schema';
import { ApiError } from '@/api/client';
import { buildFormSchema } from '@/lib/field-schema';
import { getFieldComponent } from '@/components/fields/registry';
import { CellBoundary } from '@/components/error-boundary';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface DynamicFormProps {
  module: ModuleDef;
  initialValues?: {
    display_name?: string;
    stage_id?: string | null;
    owner_id?: string | null;
    data?: Record<string, unknown>;
  };
  onSubmit: (values: {
    display_name: string;
    stage_id?: string;
    owner_id?: string;
    data: Record<string, unknown>;
  }) => Promise<void>;
  onCancel: () => void;
}

export function DynamicForm({ module, initialValues, onSubmit, onCancel }: DynamicFormProps): JSX.Element {
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const defaultValues: Record<string, any> = {
    display_name: initialValues?.display_name || '',
    stage_id: initialValues?.stage_id || (module.pipelines?.[0]?.stages?.[0]?.id || ''),
    owner_id: initialValues?.owner_id || '',
    ...(initialValues?.data || {}),
  };

  // Plan Section 11: the resolver is built from field metadata at runtime, so
  // a new field type validates without a frontend change.
  const formSchema = useMemo(() => buildFormSchema(module), [module]);

  const {
    control,
    handleSubmit,
    register,
    setError,
    formState: { errors },
  } = useForm({
    defaultValues,
    resolver: zodResolver(formSchema as never),
  });

  // Sections appear in field order, so an admin's ordering in the builder is
  // the ordering the form shows.
  const sections = Array.from(
    new Set(
      [...module.fields]
        .sort((a, b) => a.position - b.position)
        .map((f) => f.section || 'General'),
    ),
  );

  const handleFormSubmit = async (formData: Record<string, any>) => {
    setServerError(null);
    setSubmitting(true);
    try {
      const { display_name, stage_id, owner_id, ...dynamicData } = formData;
      await onSubmit({
        display_name,
        stage_id: stage_id || undefined,
        owner_id: owner_id || undefined,
        data: dynamicData,
      });
    } catch (err: unknown) {
      // The API returns RFC 7807 with a `fields` array keyed by field key
      // (Plan Section 7). Mapping it back onto the inputs is the whole point of
      // that contract; previously only a generic banner was shown.
      if (err instanceof ApiError) {
        const mapped = err.fieldErrors;
        const keys = Object.keys(mapped);
        for (const key of keys) {
          setError(key as never, { type: 'server', message: mapped[key] });
        }
        setServerError(keys.length > 0 ? err.detail : err.detail || 'Could not save this record.');
      } else {
        setServerError(err instanceof Error ? err.message : 'An error occurred while saving.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const defaultPipeline = module.pipelines?.find((p) => p.isDefault) || module.pipelines?.[0];
  const stages = defaultPipeline?.stages || [];

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
      {serverError && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">
          {serverError}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-4">
        <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">
          Core Information
        </h3>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {module.nameFieldLabel || 'Name'} <span className="text-red-500">*</span>
          </label>
          <Input
            {...register('display_name', { required: `${module.nameFieldLabel || 'Name'} is required` })}
            placeholder={`Enter ${(module.nameFieldLabel || 'name').toLowerCase()}`}
            className={errors.display_name ? 'border-red-500' : ''}
          />
          {errors.display_name && (
            <p className="mt-1 text-xs text-red-500">{String(errors.display_name.message)}</p>
          )}
        </div>

        {module.hasPipeline && stages.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Pipeline Stage
            </label>
            <Controller
              name="stage_id"
              control={control}
              render={({ field }) => (
                <select
                  {...field}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {stages.map((stg) => (
                    <option key={stg.id} value={stg.id}>
                      {stg.label}
                    </option>
                  ))}
                </select>
              )}
            />
          </div>
        )}
      </div>

      {sections.map((sectionName) => {
        const sectionFields = module.fields.filter(
          (f) => (f.section || 'General') === sectionName && !f.isSystem
        );
        if (sectionFields.length === 0) return null;

        return (
          <div key={sectionName} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">
              {sectionName}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sectionFields.map((fieldDef) => {
                const ComponentSet = getFieldComponent(fieldDef.type);
                const FieldInput = ComponentSet.Input;

                return (
                  <div key={fieldDef.key} className={fieldDef.type === 'long_text' ? 'md:col-span-2' : ''}>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {fieldDef.label}
                      {fieldDef.isRequired && <span className="text-red-500 ml-1">*</span>}
                    </label>

                    <Controller
                      name={fieldDef.key}
                      control={control}
                      rules={{
                        required: fieldDef.isRequired ? `${fieldDef.label} is required` : false,
                      }}
                      render={({ field, fieldState }) => (
                        <CellBoundary>
                          <FieldInput
                            field={fieldDef}
                            value={field.value}
                            onChange={field.onChange}
                            error={fieldState.error?.message}
                            disabled={submitting}
                          />
                        </CellBoundary>
                      )}
                    />

                    {errors[fieldDef.key] ? (
                      <p className="mt-1 text-xs text-rose-500">
                        {String((errors as Record<string, { message?: string }>)[fieldDef.key]?.message ?? '')}
                      </p>
                    ) : (
                      fieldDef.helpText && (
                        <p className="mt-1 text-xs text-slate-500">{fieldDef.helpText}</p>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting} className="bg-blue-600 hover:bg-blue-700 text-white">
          {submitting ? 'Saving...' : 'Save Record'}
        </Button>
      </div>
    </form>
  );
}
