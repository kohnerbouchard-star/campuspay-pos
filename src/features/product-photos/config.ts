import { ApiError } from '@/lib/api/errors'

export const PHOTO_ORIGIN = /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com$/
export const PHOTO_NAMESPACE = /^(development|test|production)\/[a-z0-9][a-z0-9-]{2,47}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export type PhotoConfig = { namespace: string; origin: string; token?: string; testDirectory?: string }
type Environment = Readonly<Record<string, string | undefined>>
const unavailable = () => new ApiError(503, 'CONNECTION_NOT_CONFIGURED',
  'Product photos are not configured. Ask the operator to complete photo storage setup. Product details and checkout are unchanged.')

/** Pure, independently tested validation. This module must never be imported by a client component. */
export function photoConfig(env: Environment = process.env): PhotoConfig {
  if (env.VERCEL_BLOB_API_URL || env.NEXT_PUBLIC_VERCEL_BLOB_API_URL) throw unavailable()
  const environment = env.PRODUCT_PHOTOS_ENVIRONMENT
  const storeNamespace = env.PRODUCT_PHOTOS_NAMESPACE
  if (!storeNamespace) throw unavailable()
  const namespace = `${environment}/${storeNamespace}`
  const origin = env.PRODUCT_PHOTOS_BLOB_PUBLIC_ORIGIN ?? ''
  if (env.PRODUCT_PHOTOS_ENABLED !== 'true' || env.PRODUCT_PHOTOS_PUBLIC_ACCESS !== 'acknowledged'
    || !PHOTO_NAMESPACE.test(namespace) || !PHOTO_ORIGIN.test(origin)) throw unavailable()
  const vercelEnvironment = env.VERCEL_ENV === 'production' ? 'production' : env.VERCEL_ENV === 'preview' ? 'test' : 'development'
  if (env.VERCEL && (!env.VERCEL_ENV || environment !== vercelEnvironment)) throw unavailable()
  const testDirectory = env.PRODUCT_PHOTOS_LOCAL_TEST_STORE
  if (testDirectory) {
    let local = false
    try { local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.DATABASE_URL ?? '').hostname) } catch { /* Fail closed. */ }
    // The synthetic adapter cannot be selected in any hosted Vercel environment.
    // It requires the existing CI/local-HTTP boundary AND an isolated loopback DB.
    if (env.CI !== 'true' || env.CAMPUSPAY_LOCAL_HTTP !== 'true' || env.VERCEL || env.VERCEL_ENV
      || environment !== 'test' || !local || origin !== 'https://synthetic.public.blob.vercel-storage.com'
      || !/^\/tmp\/campuspay-photos-[a-f0-9]{16,32}$/.test(testDirectory)) throw unavailable()
    return { namespace, origin, testDirectory }
  }
  const token = env.PRODUCT_PHOTOS_BLOB_READ_WRITE_TOKEN
  validatePhotoStoreToken(origin, token)
  return { namespace, origin, token }
}

export function photoKeys(config: Pick<PhotoConfig, 'namespace' | 'origin'>, productId: string, assetId: string) {
  if (!PHOTO_NAMESPACE.test(config.namespace) || !PHOTO_ORIGIN.test(config.origin)
    || !UUID.test(productId) || !UUID.test(assetId)) throw new ApiError(400, 'BAD_REQUEST', 'Invalid product photo identity')
  const prefix = `campuspay-products/${config.namespace}/${productId}/${assetId}`
  return { display: `${prefix}/display.webp`, thumbnail: `${prefix}/thumbnail.webp` }
}

/** Fail closed before PUT if a read-write token belongs to a different store.
 * The pinned SDK resolves the store ID from token segment 4; do not use its private exports.
 */
export function validatePhotoStoreToken(origin: string, token: string | undefined): void {
  const match = /^vercel_blob_rw_([A-Za-z0-9]+)_[A-Za-z0-9_-]{16,}$/.exec(token ?? '')
  if (!match || origin !== `https://${match[1].toLowerCase()}.public.blob.vercel-storage.com`) throw unavailable()
}

/** Exact public origin only; no wildcard or arbitrary remote image source in CSP. */
export function configuredPhotoOrigin(env: Environment = process.env): string | null {
  const origin = env.PRODUCT_PHOTOS_BLOB_PUBLIC_ORIGIN ?? ''
  return env.PRODUCT_PHOTOS_ENABLED === 'true' && env.PRODUCT_PHOTOS_PUBLIC_ACCESS === 'acknowledged'
    && PHOTO_ORIGIN.test(origin) ? origin : null
}
