/** One validation failure, keyed by field key so a form can mark that input. */
export interface ProblemFieldError {
  field: string;
  message: string;
}


export class ApiError extends Error {
  public readonly status: number;
  public readonly type: string;
  public readonly title: string;
  public readonly detail: string;
  public readonly fields: ProblemFieldError[];

  constructor(init: {
    status: number;
    type?: string;
    title?: string;
    detail?: string;
    fields?: ProblemFieldError[];
  }) {
    // `detail` is the sentence written for a person; `title` is the category.
    super(init.detail || init.title || `Request failed (${init.status})`);
    this.name = 'ApiError';
    this.status = init.status;
    this.type = init.type ?? 'error';
    this.title = init.title ?? 'Error';
    this.detail = init.detail ?? this.message;
    this.fields = Array.isArray(init.fields) ? init.fields : [];
  }

  /** Field errors as a map, ready for react-hook-form's setError. */
  get fieldErrors(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const f of this.fields) {
      if (f && typeof f.field === 'string' && !map[f.field]) {
        map[f.field] = String(f.message ?? 'Invalid');
      }
    }
    return map;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const isForm = options.body instanceof FormData;
  if (!headers.has('Content-Type') && !isForm && !(options.body instanceof URLSearchParams)) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(path, { ...options, headers, credentials: 'include' });
  } catch {
    // A network failure is not an HTTP status; surface it as one shape.
    throw new ApiError({
      status: 0,
      type: 'network_error',
      title: 'Network Error',
      detail: 'Could not reach the server. Check your connection and try again.',
    });
  }

  if (!response.ok) {
    if (response.status === 401 && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }

    let problem: Record<string, unknown> = {};
    try {
      problem = await response.json();
    } catch {
      problem = {};
    }

    throw new ApiError({
      status: response.status,
      type: typeof problem.type === 'string' ? problem.type : undefined,
      title: typeof problem.title === 'string' ? problem.title : response.statusText,
      detail: typeof problem.detail === 'string' ? problem.detail : undefined,
      fields: Array.isArray(problem.fields) ? (problem.fields as ProblemFieldError[]) : [],
    });
  }

  if (response.status === 204 || response.status === 304) {
    return {} as T;
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/csv') || contentType.includes('text/plain')) {
    return (await response.text()) as unknown as T;
  }
  if (!contentType.includes('json')) {
    return (await response.text()) as unknown as T;
  }

  return response.json();
}

/** Drops undefined/null/empty params instead of sending "undefined". */
function buildQuery(params?: Record<string, string | number | boolean | undefined | null>): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export const api = {
  get: <T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined | null>,
  ): Promise<T> => request<T>(`${path}${buildQuery(params)}`, { method: 'GET' }),

  post: <T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> =>
    request<T>(path, {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),

  patch: <T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> =>
    request<T>(path, {
      method: 'PATCH',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),

  del: <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' }),

  upload: <T>(path: string, file: File): Promise<T> => {
    const form = new FormData();
    form.append('file', file);
    return request<T>(path, { method: 'POST', body: form });
  },
};


export function newIdempotencyKey(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && 'randomUUID' in cryptoObj) return cryptoObj.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
