export class ApiError extends Error {
  public status: number;
  public details: Record<string, unknown>;

  constructor(status: number, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = path;
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body instanceof URLSearchParams === false) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    if (response.status === 401 && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    
    let problem = { title: 'An error occurred', details: {} };
    try {
      problem = await response.json();
    } catch {
      problem.title = response.statusText;
    }
    
    throw new ApiError(response.status, problem.title, problem.details || problem);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

export const api = {
  get: <T>(path: string, params?: Record<string, string>): Promise<T> => {
    const url = params ? `${path}?${new URLSearchParams(params).toString()}` : path;
    return request<T>(url, { method: 'GET' });
  },
  post: <T>(path: string, body?: unknown): Promise<T> => {
    return request<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  },
  patch: <T>(path: string, body?: unknown): Promise<T> => {
    return request<T>(path, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  },
  del: <T>(path: string): Promise<T> => {
    return request<T>(path, { method: 'DELETE' });
  },
};
