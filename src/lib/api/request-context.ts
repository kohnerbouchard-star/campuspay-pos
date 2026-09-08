import { AsyncLocalStorage } from 'node:async_hooks'

export const requestContext = new AsyncLocalStorage<{ requestId: string; errorCode?: string }>()

export function recordRequestError(code: string) {
  const context = requestContext.getStore()
  if (context) context.errorCode = /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'INTERNAL_ERROR'
}

export function logPoolFailure() {
  console.error(JSON.stringify({ event: 'database_pool_error', timestamp: new Date().toISOString(), code: 'DATABASE_CONNECTION_ERROR' }))
}
