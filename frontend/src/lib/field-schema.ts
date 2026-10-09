import { z } from 'zod';
import type { FieldDef, ModuleDef } from '@/api/schema';

/**
 * Builds a Zod schema for a module's form at runtime, from field metadata.
 *
 * Plan Section 11: "react-hook-form with a Zod resolver built at runtime from
 * field metadata". The form previously validated only `required` through
 * react-hook-form, so a currency field accepted "abc" and the user discovered
 * it when the server rejected the save — or worse, when `normalize()` quietly
 * turned it into nothing.
 *
 * The server validates the same values again through the compiled field types.
 * This exists so the user is told at the input, not after a round trip.
 */
function fieldSchema(field: FieldDef): z.ZodTypeAny {
  const config = (field.config ?? {}) as Record<string, unknown>;
  const label = field.label;

  const optional = (schema: z.ZodTypeAny) =>
    field.isRequired ? schema : schema.optional().nullable().or(z.literal(''));

  switch (field.type) {
    case 'number':
    case 'currency':
    case 'percent': {
      let base = z.coerce.number({ invalid_type_error: `${label} must be a number` });
      if (field.type === 'percent') base = base.min(0).max(100);
      return optional(base);
    }

    case 'boolean':
      return optional(z.coerce.boolean());

    case 'email':
      return optional(z.string().email(`${label} must be a valid email address`));

    case 'url':
      return optional(
        z.string().refine((v) => {
          if (!v) return true;
          try {
            const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`);
            return url.protocol === 'http:' || url.protocol === 'https:';
          } catch {
            return false;
          }
        }, `${label} must be a web address`),
      );

    case 'phone':
      return optional(
        z
          .string()
          .refine((v) => !v || /[0-9]{6,}/.test(v.replace(/[^\d]/g, '')), `${label} is not a valid phone number`),
      );

    case 'date':
      return optional(
        z.string().refine((v) => !v || !Number.isNaN(Date.parse(v)), `${label} must be a date`),
      );

    case 'datetime':
      return optional(
        z.string().refine((v) => !v || !Number.isNaN(Date.parse(v)), `${label} must be a date and time`),
      );

    case 'select': {
      const options = Array.isArray(config.options) ? (config.options as { id: string }[]) : [];
      const ids = options.map((o) => o.id);
      if (ids.length === 0 || config.allowOther) return optional(z.string());
      return optional(
        z.string().refine((v) => !v || ids.includes(v), `${label} must be one of its options`),
      );
    }

    case 'multi_select': {
      const options = Array.isArray(config.options) ? (config.options as { id: string }[]) : [];
      const ids = options.map((o) => o.id);
      const base = z.array(z.string());
      if (ids.length === 0) return base.optional().nullable();
      return base
        .refine((vals) => vals.every((v) => ids.includes(v)), `${label} contains an unknown option`)
        .optional()
        .nullable();
    }

    case 'tags':
      return z.array(z.string().max(120)).max(Number(config.maxTags ?? 50)).optional().nullable();

    case 'user':
    case 'lookup':
      return optional(z.string().uuid(`Choose a ${label.toLowerCase()}`));

    case 'file':
      return z
        .array(z.object({ key: z.string(), name: z.string() }).passthrough())
        .optional()
        .nullable();

    case 'auto_number':
      // Server-allocated and read-only.
      return z.any().optional();

    case 'long_text':
    case 'text':
    default: {
      let base = z.string();
      const maxLength = Number(config.maxLength);
      if (Number.isFinite(maxLength) && maxLength > 0) {
        base = base.max(maxLength, `${label} must be ${maxLength} characters or fewer`);
      }
      return field.isRequired ? base.min(1, `${label} is required`) : optional(base);
    }
  }
}

export function buildFormSchema(module: ModuleDef): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {
    display_name: z.string().min(1, `${module.nameFieldLabel || 'Name'} is required`).max(500),
    stage_id: z.string().optional().nullable(),
    owner_id: z.string().optional().nullable(),
  };

  for (const field of module.fields) {
    if (field.isSystem) continue;
    shape[field.key] = fieldSchema(field);
  }

  // Unknown keys are stripped rather than rejected: the form only ever submits
  // what it rendered, and the API is the authority on the rest.
  return z.object(shape);
}
