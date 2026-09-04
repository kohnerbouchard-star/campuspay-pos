import { apiFetch } from '@/lib/api/client'
import type { SessionContext } from '@/features/auth/domain'

export type LoginResult = SessionContext & { workspace: string }

export function login(employeeCode: string, pin: string) {
  return apiFetch<LoginResult>('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ employeeCode, pin }),
  })
}

export function logout() {
  return apiFetch<{ signedOut: true }>('/api/auth/logout', { method: 'POST' })
}

export function recordActivity() {
  return apiFetch<{ expiresAt: string }>('/api/auth/activity', { method: 'POST' })
}
