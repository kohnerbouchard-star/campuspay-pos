import { apiFetch } from '@/lib/api/client'
import { CompletionDecisionSchema, type CompleteEnrollmentInput } from './completion-domain'

export async function postRosterCompletion(studentId: string, input: CompleteEnrollmentInput) {
  return CompletionDecisionSchema.parse(await apiFetch<unknown>(`/api/students/${studentId}/complete-enrollment`, { method: 'POST', body: JSON.stringify(input) }))
}
export async function recoverRosterCompletion(studentId: string, idempotencyKey: string) {
  return CompletionDecisionSchema.parse(await apiFetch<unknown>(`/api/students/${studentId}/recover-completion`, { method: 'POST', body: JSON.stringify({ idempotencyKey }) }))
}
