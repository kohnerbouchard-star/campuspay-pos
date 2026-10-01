import { NextResponse } from 'next/server'
import { ApiError, toApiError } from '@/lib/api/errors'
import { productionSurfaceConfiguration } from '@/lib/http/security-headers'
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
  const origin = request.headers.get('origin')
  const url = new URL(request.url)
  const requestOrigin = url.origin
  const storeSurface = url.pathname.startsWith('/api/store/')
  const production = process.env.NODE_ENV === 'production'

  if (production) {
    const surfaces = productionSurfaceConfiguration(process.env.STAFF_ORIGIN, process.env.STORE_ORIGIN, true)
    if (!surfaces) {
      throw new ApiError(503, 'CONNECTION_NOT_CONFIGURED', 'The service is temporarily unavailable. Please try again later.')
    }
    const expectedOrigin = storeSurface ? surfaces.storeOrigin : surfaces.staffOrigin
    // Production mutations are browser-only and must arrive on, and originate
    // from, the exact configured surface. APP_ORIGIN is never a production fallback.
    if (requestOrigin !== expectedOrigin || origin !== expectedOrigin || request.headers.get('sec-fetch-site') === 'cross-site') {
      throw new ApiError(403, 'FORBIDDEN', 'Cross-origin requests are not accepted')
    }
    return
  }

  const surfaceOrigin = storeSurface ? process.env.STORE_ORIGIN : process.env.STAFF_ORIGIN
  const allowedOrigins = new Set([requestOrigin, surfaceOrigin || process.env.APP_ORIGIN].filter(Boolean))
  if ((origin && !allowedOrigins.has(origin)) || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new ApiError(403, 'FORBIDDEN', 'Cross-origin requests are not accepted')
  }
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
