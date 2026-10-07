export const STORE_REQUEST_TIMEOUT_MS = 30_000

/** A deadline is transport uncertainty, never a confirmed application rejection. */
export class StoreRequestTimeoutError extends Error {
  constructor() {
    super('The request timed out. Its result is unknown; recover the original request before placing another order.')
    this.name = 'StoreRequestTimeoutError'
  }
}

/** Bounds both fetch AND response-body parsing, even if a transport ignores abort.
 * Only the first outcome settles. No retry/replacement request is ever made. */
export function withStoreTimeout<T>(request: (signal: AbortSignal) => Promise<T>, timeoutMs = STORE_REQUEST_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController()
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new StoreRequestTimeoutError())
      controller.abort()
    }, timeoutMs)
    Promise.resolve().then(() => request(controller.signal)).then(value => {
      if (settled) return
      settled = true; clearTimeout(timer); resolve(value)
    }, error => {
      if (settled) return
      settled = true; clearTimeout(timer); reject(error)
    })
  })
}
