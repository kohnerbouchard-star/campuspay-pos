import { apiFetch } from '@/lib/api/client'
import type { SecurityStudent } from '@/features/security/domain'

export function searchSecurityStudents(query: string) {
  return apiFetch<SecurityStudent[]>(`/api/security/students?q=${encodeURIComponent(query)}`)
}

export function requestStepUp(input: { superAdminEmployeeCode: string; superAdminPin: string; purpose: 'RESET_STUDENT_PIN' | 'RESET_STUDENT_CARD' | 'COMPLETE_STUDENT_PIN'; studentId: string }) {
  return apiFetch<{ authorizationToken: string; expiresAt: string }>('/api/security/step-up', { method: 'POST', body: JSON.stringify(input) })
}

export function postPinReset(studentId: string, input: { authorizationToken: string; newPin: string; confirmationPin: string }) {
  return apiFetch<{ audit_reference: string; completed_at: string }>(`/api/security/students/${studentId}/pin-reset`, { method: 'POST', body: JSON.stringify(input) })
}

export function postCardReset(studentId: string, input: { authorizationToken: string; newCardRead: string }) {
  return apiFetch<{ audit_reference: string; completed_at: string }>(`/api/security/students/${studentId}/card-reset`, { method: 'POST', body: JSON.stringify(input) })
}

export function completeMissingPin(studentId: string, input: { authorizationToken: string; newPin: string; confirmationPin: string; identityVerified: true }) {
  return apiFetch<{ audit_reference: string; completed_at: string }>(`/api/security/students/${studentId}/complete-pin`, { method: 'POST', body: JSON.stringify(input) })
}
