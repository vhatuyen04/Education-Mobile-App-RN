import { API_BASE_URL } from '../config/api';

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type AuthResponse = {
  user: AuthUser;
} & AuthTokens;

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = data?.error ?? `Request failed (${res.status})`;
    throw new Error(message);
  }

  return data as T;
}

export async function register(email: string, password: string, name?: string): Promise<AuthResponse> {
  return postJson<AuthResponse>('/auth/register', { email, password, name });
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  return postJson<AuthResponse>('/auth/login', { email, password });
}

export async function logout(refreshToken: string): Promise<{ ok: true }> {
  return postJson<{ ok: true }>('/auth/logout', { refreshToken });
}
