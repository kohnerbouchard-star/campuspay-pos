export const DATABASE_UPGRADE_MESSAGE = 'CampusPay needs a database update before this version can be used.'

export type ApiErrorCode =
  | 'DATABASE_UPGRADE_REQUIRED'
  | 'ADMINISTRATION_DISABLED'
  | 'LAST_ADMIN_REQUIRED'
  | 'OPEN_CASH_SHIFT'
  | 'CASH_CONTROLS_DISABLED'
  | 'CASH_SHIFT_REQUIRED'
  | 'CASH_DISABLED'
  | 'CASH_UNDERPAYMENT'
  | 'TENDER_INVALID'
  | 'COUPON_IDENTITY_REQUIRED'
  | 'PRICE_CHANGED'
  | 'ENROLLMENT_REQUIRED'
  | 'INCOMPLETE_ENROLLMENT'
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

  const sqlState = error && typeof error === 'object' && 'code' in error ? error.code : null
  if (['22P02', '22007', '22008'].includes(String(sqlState))) return new ApiError(400, 'BAD_REQUEST', 'Request parameters are invalid')

  const message = error instanceof Error ? error.message : 'Unexpected error'
  if (message.includes('DATABASE_NOT_CONFIGURED') || message.includes('NEON_NOT_CONFIGURED')) return new ApiError(503, 'CONNECTION_NOT_CONFIGURED', 'The service is temporarily unavailable. Please try again later.')
  if (message.includes('INCOMPLETE_ENROLLMENT')) return new ApiError(409, 'INCOMPLETE_ENROLLMENT', 'This student has an incomplete credential setup. Ask a Super Admin to complete the missing PIN on the existing account.')
  if (message.includes('ENROLLMENT_REQUIRED')) return new ApiError(409, 'ENROLLMENT_REQUIRED', 'This student is not enrolled for card access. Complete enrollment on the existing roster entry; do not create another student.')
  if (message.includes('SESSION_EXPIRED')) return new ApiError(401, 'SESSION_EXPIRED', 'Session expired')
  if (message.includes('UNAUTHENTICATED')) return new ApiError(401, 'UNAUTHENTICATED', 'Authentication required')
  if (message.includes('FORBIDDEN')) return new ApiError(403, 'FORBIDDEN', 'Permission denied')
  if (message.includes('INVALID_PIN')) return new ApiError(401, 'INVALID_PIN', 'PIN verification failed')
  if (message.includes('RATE_LIMITED')) return new ApiError(429, 'RATE_LIMITED', 'Too many attempts; try again later')
  if (message.includes('FUNDING_WORKFLOW_REQUIRED')) return new ApiError(409, 'CONFLICT', 'Use Wallet funding and cash movements; legacy wallet adjustments are retired after adoption.')
  if (message.includes('FUNDING_DISABLED')) return new ApiError(409, 'CONFLICT', 'Funding and cash movement posting is not activated.')
  if (message.includes('CASH_INSUFFICIENT')) return new ApiError(409, 'CONFLICT', 'The recorded drawer cash does not cover this payout. Nothing was posted.')
  if (message.includes('EXPORT_TOO_LARGE')) return new ApiError(400, 'BAD_REQUEST', 'More than 50,000 records match. Choose a narrower date or search filter; no rows were omitted.')
  if (message.includes('ADMINISTRATION_DISABLED')) return new ApiError(409, 'ADMINISTRATION_DISABLED', 'Administrative changes are not activated.')
  if (message.includes('LAST_ADMIN_REQUIRED')) return new ApiError(409, 'LAST_ADMIN_REQUIRED', 'At least one active administrator must remain.')
  if (message.includes('OPEN_CASH_SHIFT')) return new ApiError(409, 'OPEN_CASH_SHIFT', 'Close the affected cash drawer before changing this access.')
  if (message.includes('CASH_SHIFT_REQUIRED')) return new ApiError(409, 'CASH_SHIFT_REQUIRED', 'Open a cash shift at this terminal before accepting or paying cash. Nothing was settled.')
  if (message.includes('CASH_CONTROLS_DISABLED')) return new ApiError(409, 'CASH_CONTROLS_DISABLED', 'Cash drawer controls are not activated.')
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
