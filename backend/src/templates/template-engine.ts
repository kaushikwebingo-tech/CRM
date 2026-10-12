export interface TemplateContext {
  record?: {
    id?: string;
    displayName?: string;
    data?: Record<string, unknown>;
    stage?: string;
    createdAt?: string;
  };
  owner?: {
    id?: string;
    fullName?: string;
    email?: string;
    phone?: string;
  };
  actor?: {
    id?: string;
    fullName?: string;
    email?: string;
  };
  org?: {
    name?: string;
    slug?: string;
    email?: string;
  };
  link?: Record<string, string>;
  related?: Record<string, Record<string, unknown>>;
}

export class TemplateEngine {
  static formatCurrency(val: unknown): string {
    const num = Number(val);
    if (!Number.isFinite(num)) return String(val ?? '');
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(num);
  }

  static formatDate(val: unknown): string {
    if (!val) return '';
    const d = new Date(String(val));
    if (isNaN(d.getTime())) return String(val);
    return d.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  static resolvePath(path: string, ctx: TemplateContext): unknown {
    const trimmed = path.trim();
    if (trimmed === 'display_name') return ctx.record?.displayName ?? '';
    if (trimmed === 'stage') return ctx.record?.stage ?? '';
    if (trimmed === 'created_at') return ctx.record?.createdAt ?? '';
    if (trimmed === 'id') return ctx.record?.id ?? '';

    if (trimmed.startsWith('data.')) {
      const key = trimmed.slice(5);
      return ctx.record?.data?.[key];
    }

    if (trimmed.startsWith('owner.')) {
      const key = trimmed.slice(6);
      if (key === 'full_name' || key === 'fullName') return ctx.owner?.fullName;
      if (key === 'email') return ctx.owner?.email;
      if (key === 'phone') return ctx.owner?.phone;
      return (ctx.owner as any)?.[key];
    }

    if (trimmed.startsWith('actor.')) {
      const key = trimmed.slice(6);
      if (key === 'full_name' || key === 'fullName') return ctx.actor?.fullName;
      if (key === 'email') return ctx.actor?.email;
      return (ctx.actor as any)?.[key];
    }

    if (trimmed.startsWith('org.')) {
      const key = trimmed.slice(4);
      return (ctx.org as any)?.[key];
    }

    if (trimmed.startsWith('link.')) {
      const key = trimmed.slice(5);
      return ctx.link?.[key];
    }

    if (trimmed.startsWith('related.')) {
      const parts = trimmed.split('.');
      if (parts.length >= 3) {
        const lookup = parts[1];
        const field = parts.slice(2).join('.');
        return ctx.related?.[lookup]?.[field];
      }
    }

    if (ctx.record?.data?.[trimmed] !== undefined) {
      return ctx.record.data[trimmed];
    }

    return undefined;
  }

  static applyPipe(value: unknown, pipe: string): string {
    const [name, ...argParts] = pipe.trim().split(':');
    const arg = argParts.join(':').replace(/^['"]|['"]$/g, '');

    switch (name.trim()) {
      case 'upper':
        return String(value ?? '').toUpperCase();
      case 'lower':
        return String(value ?? '').toLowerCase();
      case 'capitalize': {
        const str = String(value ?? '');
        return str.charAt(0).toUpperCase() + str.slice(1);
      }
      case 'currency':
        return this.formatCurrency(value);
      case 'date':
        return this.formatDate(value);
      case 'default':
        return (value === null || value === undefined || value === '') ? arg : String(value);
      default:
        return String(value ?? '');
    }
  }

  static renderExpression(expr: string, ctx: TemplateContext, escapeHtml = false): string {
    const parts = expr.split('|').map((p) => p.trim());
    const varPath = parts[0];
    const pipes = parts.slice(1);

    let val = this.resolvePath(varPath, ctx);

    if (pipes.length === 0) {
      if (val === null || val === undefined) return '';
      const str = String(val);
      return escapeHtml ? this.escapeHtml(str) : str;
    }

    let result = val;
    for (const pipe of pipes) {
      result = this.applyPipe(result, pipe);
    }

    const str = String(result ?? '');
    return escapeHtml ? this.escapeHtml(str) : str;
  }

  static escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  static renderConditionals(template: string, ctx: TemplateContext, depth = 0): string {
    if (depth > 3) return template;

    const ifRegex = /\{\{#if\s+([\w\.]+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/;
    let match = ifRegex.exec(template);

    while (match) {
      const fullMatch = match[0];
      const conditionPath = match[1];
      const truthyBlock = match[2];
      const falsyBlock = match[3] || '';

      const condVal = this.resolvePath(conditionPath, ctx);
      const isTruthy = Boolean(
        condVal &&
          (typeof condVal !== 'string' || condVal.trim() !== '') &&
          (typeof condVal !== 'number' || condVal !== 0) &&
          (!Array.isArray(condVal) || condVal.length > 0)
      );

      const replacement = isTruthy ? truthyBlock : falsyBlock;
      template = template.replace(fullMatch, replacement);
      match = ifRegex.exec(template);
    }

    return template;
  }

  static render(
    template: string,
    ctx: TemplateContext,
    options: { escapeHtml?: boolean } = {},
  ): string {
    if (!template || typeof template !== 'string') return '';

    let processed = this.renderConditionals(template, ctx);

    const varRegex = /\{\{([^#\/][\s\S]*?)\}\}/g;
    processed = processed.replace(varRegex, (_, expr) => {
      const trimmed = expr.trim();
      if (trimmed === 'else') return '';
      return this.renderExpression(trimmed, ctx, options.escapeHtml);
    });

    return processed;
  }

  static extractVariables(template: string): string[] {
    if (!template) return [];
    const vars = new Set<string>();
    const regex = /\{\{(?:#if\s+)?([^#\/\}]+)\}\}/g;
    let m;
    while ((m = regex.exec(template)) !== null) {
      const content = m[1].trim();
      if (content === 'else') continue;
      const path = content.split('|')[0].trim();
      if (path) vars.add(path);
    }
    return Array.from(vars);
  }

  static validate(
    template: string,
    allowedFieldKeys?: string[],
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    const vars = this.extractVariables(template);
    const validRootNamespaces = ['display_name', 'stage', 'created_at', 'id', 'data', 'owner', 'actor', 'org', 'link', 'related'];

    for (const v of vars) {
      const parts = v.split('.');
      const root = parts[0];
      if (!validRootNamespaces.includes(root)) {
        errors.push(`Unknown variable root namespace: "${root}" in {{${v}}}`);
        continue;
      }

      if (root === 'data' && allowedFieldKeys && allowedFieldKeys.length > 0) {
        const fieldKey = parts[1];
        if (fieldKey && !allowedFieldKeys.includes(fieldKey)) {
          errors.push(`Field "${fieldKey}" is not defined in the module fields`);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
