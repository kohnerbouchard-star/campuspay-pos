/** Pure configuration policy shared by proxy, route handlers and cookie setup. */
export type DeploymentEnv = Record<string, string | undefined>
export type DeploymentPolicy = { mode: 'local' | 'production'; staff: string | null; store: string | null; local: string | null }
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])
function origin(value: string): URL {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('DEPLOYMENT_CONFIGURATION_INVALID')
  return url
}
export function deploymentPolicy(env: DeploymentEnv): DeploymentPolicy {
  const localOverride = env.CAMPUSPAY_LOCAL_HTTP === 'true'
  if (localOverride && env.VERCEL === '1') throw new Error('DEPLOYMENT_CONFIGURATION_INVALID')
  const production = !localOverride && (env.NODE_ENV === 'production' || Boolean(env.STAFF_ORIGIN || env.STORE_ORIGIN))
  if (production) {
    if (!env.STAFF_ORIGIN || !env.STORE_ORIGIN || (env.COOKIE_SECURE !== undefined && env.COOKIE_SECURE !== 'true')) throw new Error('DEPLOYMENT_CONFIGURATION_INVALID')
    const staff = origin(env.STAFF_ORIGIN), store = origin(env.STORE_ORIGIN)
    // Different ports do not isolate host-only cookies: require different hostnames.
    if (staff.protocol !== 'https:' || store.protocol !== 'https:' || staff.hostname === store.hostname || LOOPBACK.has(staff.hostname) || LOOPBACK.has(store.hostname)) throw new Error('DEPLOYMENT_CONFIGURATION_INVALID')
    if (env.DATABASE_URL_UNPOOLED) throw new Error('DEPLOYMENT_CONFIGURATION_INVALID')
    if (env.VERCEL !== '1' && (!env.CAMPUSPAY_INGRESS_SECRET || env.CAMPUSPAY_INGRESS_SECRET.length < 32)) throw new Error('DEPLOYMENT_CONFIGURATION_INVALID')
    return { mode: 'production', staff: staff.origin, store: store.origin, local: null }
  }
  if (localOverride && (!env.APP_ORIGIN || env.STAFF_ORIGIN || env.STORE_ORIGIN)) throw new Error('DEPLOYMENT_CONFIGURATION_INVALID')
  const local = env.APP_ORIGIN ? origin(env.APP_ORIGIN) : null
  if (local && !LOOPBACK.has(local.hostname)) throw new Error('DEPLOYMENT_CONFIGURATION_INVALID')
  return { mode: 'local', staff: null, store: null, local: local?.origin ?? null }
}
export function approvedOrigin(request: Request, policy: DeploymentPolicy): string | null {
  const url = new URL(request.url)
  const host = (request.headers.get('host') ?? url.host).toLowerCase()
  if (policy.mode === 'production') {
    return [policy.staff!, policy.store!].find(value => new URL(value).host === host) ?? null
  }
  if (policy.local) return new URL(policy.local).host === host ? policy.local : null
  // Unconfigured development is loopback-only; never trust a supplied public Host.
  if (host !== url.host.toLowerCase() || !LOOPBACK.has(url.hostname)) return null
  return url.origin
}
export function mutationOriginAllowed(request: Request, policy: DeploymentPolicy): boolean {
  const expected = approvedOrigin(request, policy)
  if (!expected || request.headers.get('sec-fetch-site') === 'cross-site') return false
  if (policy.mode === 'production') {
    const surface = new URL(request.url).pathname.startsWith('/api/store/') ? policy.store : policy.staff
    if (surface !== expected) return false
  }
  const supplied = request.headers.get('origin')
  return supplied === expected || (!supplied && policy.mode === 'local')
}
