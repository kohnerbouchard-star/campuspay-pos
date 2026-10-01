import { NextResponse } from 'next/server'
import { ApiError, toApiError } from '@/lib/api/errors'
import { deploymentPolicy, mutationOriginAllowed } from '@/lib/http/deployment-policy'
import { recordRequestError } from './request-context'

export type ApiSuccess<T> = { ok: true; data: T }
export type ApiFailure = { ok: false; error: { code: string; message: string; details?: unknown } }

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json<ApiSuccess<T>>({ ok: true, data }, init)
}

export function failure(error: unknown) {
  const normalized = toApiError(error)
  recordRequestError(normalized.code)
  return NextResponse.json<ApiFailure>(
    {
      ok: false,
      error: {
        code: normalized.code,
        message: normalized.message,
        ...(normalized.details === undefined ? {} : { details: normalized.details }),
      },
    },
    { status: normalized.status },
  )
}

export function assertMutationOrigin(request: Request): void {
  let policy
  try { policy = deploymentPolicy(process.env) }
  catch { throw new ApiError(503, 'CONNECTION_NOT_CONFIGURED', 'The service is not configured for public access.') }
  if (!mutationOriginAllowed(request, policy)) throw new ApiError(403, 'FORBIDDEN', 'Cross-origin requests are not accepted')
}

export async function parseJson<T>(request: Request, parser: { parse(value: unknown): T }): Promise<T> {
  assertMutationOrigin(request)
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError(400, 'BAD_REQUEST', 'Request body must be valid JSON')
  }
  try {
    return parser.parse(body)
  } catch {
    throw new ApiError(400, 'BAD_REQUEST', 'Request validation failed')
  }
}
