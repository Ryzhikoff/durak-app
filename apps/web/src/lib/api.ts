import axios, { AxiosError, AxiosInstance } from 'axios';
import type { ApiErrorBody } from '@durak/shared-types';

/**
 * Axios instance for the Durak API.
 *
 * - Uses cookie-based sessions (HttpOnly), so `withCredentials: true`.
 * - All requests share the `/api` prefix; in dev Vite proxies to the API.
 */
export const api: AxiosInstance = axios.create({
  baseURL: '/api',
  withCredentials: true,
  // The API throws on >= 400 — let axios use defaults.
});

const PUBLIC_PATHS = ['/auth/login', '/auth/me', '/admin/setup', '/admin/setup/status'];

function isPublicPath(url?: string): boolean {
  if (!url) return false;
  // url may include baseURL or not; normalize by stripping baseURL.
  const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api/, '');
  return PUBLIC_PATHS.some((p) => path === p);
}

// Lazy redirect to avoid circular deps with react-router.
let onUnauthorized: (() => void) | null = null;
export function registerUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiErrorBody>) => {
    const status = error.response?.status;
    const cfgUrl = error.config?.url;
    if (status === 401 && !isPublicPath(cfgUrl)) {
      onUnauthorized?.();
    }
    return Promise.reject(error);
  },
);

/**
 * Pull the error code/message from the API envelope, fallback to axios message.
 * Callers MUST provide a fallback (usually a translated string) — there is no
 * default to ensure UI never accidentally surfaces a hardcoded Russian string.
 */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as ApiErrorBody | undefined;
    if (body?.error?.message) return body.error.message;
    if (err.message) return err.message;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

export function getApiErrorCode(err: unknown): string | undefined {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as ApiErrorBody | undefined;
    return body?.error?.code;
  }
  return undefined;
}
