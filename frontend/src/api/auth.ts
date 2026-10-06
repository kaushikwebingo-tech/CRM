import { api } from '@/api/client';

export interface User {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  orgId: string;
  role: {
    id: string;
    name: string;
    permissions: Record<string, unknown>;
  };
}

export function login(email: string, password: string): Promise<User> {
  return api.post<User>('/api/auth/login', { email, password });
}

export function logout(): Promise<void> {
  return api.post<void>('/api/auth/logout');
}

export function getMe(): Promise<User> {
  return api.get<User>('/api/auth/me');
}
