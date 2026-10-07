import { apiFetch } from '@/lib/api/client'
import type { SessionContext } from '@/features/auth/domain'

export type LoginResult = SessionContext & { workspace: string }

export function login(employeeCode: string, pin: string) {
  return apiFetch<LoginResult>('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ employeeCode, pin }),
  })
}

export async function logout() {
  const value = await apiFetch<unknown>('/api/auth/logout', { method: 'POST' })
  if (!value || typeof value !== 'object' || !('signedOut' in value) || value.signedOut !== true) throw new Error('Sign-out response was not confirmed')
  return { signedOut: true as const }
}

export function recordActivity() {
  return apiFetch<{ expiresAt: string }>('/api/auth/activity', { method: 'POST' })
}
