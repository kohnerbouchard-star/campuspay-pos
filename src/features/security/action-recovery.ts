/** Only pass errors already verified as ClientApiError by the API client. */
type ConfirmedApiFailure = { code: string; message: string; status: number }
export type SecurityActionFailure = { message: string; needsSignIn: boolean; needsReview: boolean }

export function authorizationRemainingMs(expiresAt: string, now = Date.now()): number {
  const expiry = Date.parse(expiresAt)
  // Invalid dates must not pass the client expiry guard. Server authorization
  // remains authoritative; cap the UI timer to the one-minute approval window.
  return Number.isFinite(expiry) ? Math.min(60_000, Math.max(0, expiry - now)) : 0
}

export function isStepUpAuthorization(value: unknown, now = Date.now()): value is { authorizationToken: string; expiresAt: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const result = value as Record<string, unknown>
  return typeof result.authorizationToken === 'string' && result.authorizationToken.trim().length >= 32
    && typeof result.expiresAt === 'string' && authorizationRemainingMs(result.expiresAt, now) > 0
}

export function isResetReceipt(value: unknown): value is { audit_reference: string; completed_at: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const result = value as Record<string, unknown>
  return typeof result.audit_reference === 'string' && result.audit_reference.trim().length > 0
    && typeof result.completed_at === 'string' && Number.isFinite(Date.parse(result.completed_at))
}

export function securityActionFailure(
  stage: 'authorize' | 'reset',
  failure: ConfirmedApiFailure | null,
): SecurityActionFailure {
  if (!failure || failure.status >= 500) {
    return stage === 'reset'
      ? {
        message: 'The reset result could not be confirmed. The PIN or card may already have changed. Check the student’s credential status with a Super Admin before starting another reset.',
        needsSignIn: false,
        needsReview: true,
      }
      : {
        message: 'Super Admin approval could not be confirmed. No reset was submitted. Check the connection before requesting fresh approval.',
        needsSignIn: false,
        needsReview: false,
      }
  }
  if (failure.code === 'UNAUTHENTICATED' || failure.code === 'SESSION_EXPIRED') {
    return {
      message: 'Your staff session ended. Sign in again on the staff site, then request fresh Super Admin approval. This request did not change the student’s credentials.',
      needsSignIn: true,
      needsReview: false,
    }
  }
  if (stage === 'authorize' && (failure.code === 'INVALID_PIN' || failure.code === 'RATE_LIMITED')) {
    return {
      message: 'Independent approval was denied. Check the employee ID and PIN, or allow a temporary lock to clear. No student credential was changed.',
      needsSignIn: false,
      needsReview: false,
    }
  }
  if (failure.code === 'FORBIDDEN') {
    return {
      message: 'The request was not authorized. Use the staff site and check your access with a Super Admin. A reset requires fresh approval for the selected student and action.',
      needsSignIn: false,
      needsReview: false,
    }
  }
  if (failure.code === 'NOT_FOUND') {
    return {
      message: 'The selected student or credential could not be found. Check the student’s record and enrollment before requesting another reset.',
      needsSignIn: false,
      needsReview: false,
    }
  }
  return { message: failure.message, needsSignIn: false, needsReview: false }
}
