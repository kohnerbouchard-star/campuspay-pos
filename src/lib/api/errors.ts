export const DATABASE_UPGRADE_MESSAGE = 'CampusPay needs a database update before this version can be used.'

export type ApiErrorCode =
  | 'DATABASE_UPGRADE_REQUIRED'
  | 'CASH_DISABLED'
  | 'CASH_UNDERPAYMENT'
  | 'TENDER_INVALID'
  | 'COUPON_IDENTITY_REQUIRED'
  | 'PRICE_CHANGED'
  | 'BAD_REQUEST'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'SESSION_EXPIRED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INVENTORY_SHORTAGE'
  | 'WALLET_LIMIT'
  | 'INVALID_PIN'
  | 'COUPON_INVALID'
  | 'COUPON_EXPIRED'
  | 'COUPON_MINIMUM'
  | 'COUPON_LIMIT'
  | 'COUPON_UNAVAILABLE'
  | 'COUPON_STUDENT_LIMIT'
  | 'CONNECTION_NOT_CONFIGURED'
  | 'INTERNAL_ERROR'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (error instanceof Error && error.cause instanceof Error && error.cause !== error) return toApiError(error.cause)

  const message = error instanceof Error ? error.message : 'Unexpected error'
  if (message.includes('DATABASE_NOT_CONFIGURED') || message.includes('NEON_NOT_CONFIGURED')) return new ApiError(503, 'CONNECTION_NOT_CONFIGURED', 'The service is temporarily unavailable. Please try again later.')
  if (message.includes('SESSION_EXPIRED')) return new ApiError(401, 'SESSION_EXPIRED', 'Session expired')
  if (message.includes('UNAUTHENTICATED')) return new ApiError(401, 'UNAUTHENTICATED', 'Authentication required')
  if (message.includes('FORBIDDEN')) return new ApiError(403, 'FORBIDDEN', 'Permission denied')
  if (message.includes('INVALID_PIN')) return new ApiError(401, 'INVALID_PIN', 'PIN verification failed')
  if (message.includes('RATE_LIMITED')) return new ApiError(429, 'RATE_LIMITED', 'Too many attempts; try again later')
  if (message.includes('CASH_DISABLED')) return new ApiError(409, 'CASH_DISABLED', 'Cash payments are disabled for this terminal.')
  if (message.includes('CASH_UNDERPAYMENT')) return new ApiError(409, 'CASH_UNDERPAYMENT', 'Cash received must cover the full cash amount due. Nothing has been charged.')
  if (message.includes('TENDER_INVALID')) return new ApiError(409, 'TENDER_INVALID', 'The payment amounts must cover the total exactly.')
  if (message.includes('COUPON_IDENTITY_REQUIRED')) return new ApiError(409, 'COUPON_IDENTITY_REQUIRED', 'This coupon has a per-student limit. Use MICA Money or remove the coupon.')
  if (message.includes('PRICE_CHANGED')) return new ApiError(409, 'PRICE_CHANGED', 'The total changed. Review your order and payment amounts again.')
  if (message.includes('WALLET_LIMIT')) return new ApiError(409, 'WALLET_LIMIT', 'Transaction exceeds the wallet limit')
  if (message.includes('INVENTORY_SHORTAGE')) return new ApiError(409, 'INVENTORY_SHORTAGE', 'Insufficient inventory')
  if (message.includes('COUPON_STUDENT_LIMIT')) return new ApiError(409, 'COUPON_STUDENT_LIMIT', 'This student has reached the coupon use limit')
  if (message.includes('COUPON_UNAVAILABLE')) return new ApiError(409, 'COUPON_UNAVAILABLE', 'This coupon is no longer available')
  if (message.includes('COUPON_MINIMUM')) return new ApiError(409, 'COUPON_MINIMUM', 'The order does not meet the coupon minimum')
  if (message.includes('COUPON_LIMIT')) return new ApiError(409, 'COUPON_LIMIT', 'This coupon has reached its redemption limit')
  if (message.includes('COUPON_EXPIRED')) return new ApiError(409, 'COUPON_EXPIRED', 'This coupon is inactive, not started, or expired')
  if (message.includes('COUPON_INVALID')) return new ApiError(404, 'COUPON_INVALID', 'Coupon code is invalid')
  if (message.includes('NOT_FOUND')) return new ApiError(404, 'NOT_FOUND', 'Record not found')
  if (message.includes('CONFLICT')) return new ApiError(409, 'CONFLICT', 'Conflicting operation')
  if (message.includes('BAD_REQUEST')) return new ApiError(400, 'BAD_REQUEST', 'Request validation failed')

  return new ApiError(500, 'INTERNAL_ERROR', 'The operation could not be completed')
}
