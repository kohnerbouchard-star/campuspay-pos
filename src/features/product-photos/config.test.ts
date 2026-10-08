import { describe, it, expect } from 'vitest'
import { configuredPhotoOrigin, photoConfig, photoKeys } from './config'

const env = {
  PRODUCT_PHOTOS_ENABLED: 'true', PRODUCT_PHOTOS_PUBLIC_ACCESS: 'acknowledged',
  PRODUCT_PHOTOS_ENVIRONMENT: 'test', PRODUCT_PHOTOS_NAMESPACE: 'synthetic-test',
  PRODUCT_PHOTOS_BLOB_PUBLIC_ORIGIN: 'https://synthetic.public.blob.vercel-storage.com',
  PRODUCT_PHOTOS_BLOB_READ_WRITE_TOKEN: `${['vercel', 'blob', 'rw', 'synthetic'].join('_')}_${'synthetic'.repeat(4)}`,
}
const id = 'a1000000-0000-4000-8000-000000000001'
describe('photo storage configuration and identity', () => {
  it('requires explicit enablement, public access acceptance and all storage settings', () => {
    expect(photoConfig(env).namespace).toBe('test/synthetic-test')
    for (const key of Object.keys(env)) expect(() => photoConfig({ ...env, [key]: undefined })).toThrow()
    expect(() => photoConfig({ ...env, PRODUCT_PHOTOS_PUBLIC_ACCESS: 'private' })).toThrow()
  })
  it('rejects injected origins, keys, namespaces and mismatched deployment environments', () => {
    for (const origin of ['http://synthetic.public.blob.vercel-storage.com', 'https://user@synthetic.public.blob.vercel-storage.com', `${env.PRODUCT_PHOTOS_BLOB_PUBLIC_ORIGIN}/`, `${env.PRODUCT_PHOTOS_BLOB_PUBLIC_ORIGIN}?secret=1`, 'https://other.invalid'])
      expect(() => photoConfig({ ...env, PRODUCT_PHOTOS_BLOB_PUBLIC_ORIGIN: origin })).toThrow()
    for (const namespace of ['../production', 'a/b', '', 'with space']) expect(() => photoConfig({ ...env, PRODUCT_PHOTOS_NAMESPACE: namespace })).toThrow()
    expect(() => photoConfig({ ...env, PRODUCT_PHOTOS_BLOB_PUBLIC_ORIGIN: 'https://other.public.blob.vercel-storage.com' })).toThrow()
    expect(() => photoConfig({ ...env, VERCEL_BLOB_API_URL: 'https://other.invalid' })).toThrow()
    expect(() => photoConfig({ ...env, NEXT_PUBLIC_VERCEL_BLOB_API_URL: 'https://other.invalid' })).toThrow()
    expect(() => photoConfig({ ...env, VERCEL: '1', VERCEL_ENV: 'production' })).toThrow()
    expect(() => photoConfig({ ...env, VERCEL: '1' })).toThrow()
    expect(photoConfig({ ...env, VERCEL: '1', VERCEL_ENV: 'preview' }).namespace).toBe('test/synthetic-test')
    expect(() => photoKeys(photoConfig(env), '../escape', id)).toThrow()
    expect(photoKeys(photoConfig(env), id, id).display).toBe(`campuspay-products/test/synthetic-test/${id}/${id}/display.webp`)
  })
  it('makes the filesystem fake impossible on Vercel and remote databases', () => {
    const local = { ...env, PRODUCT_PHOTOS_BLOB_READ_WRITE_TOKEN: undefined, PRODUCT_PHOTOS_LOCAL_TEST_STORE: '/tmp/campuspay-photos-0123456789abcdef', CI: 'true', CAMPUSPAY_LOCAL_HTTP: 'true', DATABASE_URL: 'postgres://synthetic:synthetic@127.0.0.1/synthetic' }
    expect(photoConfig(local).testDirectory).toBe(local.PRODUCT_PHOTOS_LOCAL_TEST_STORE)
    for (const override of [{ CI: undefined }, { CAMPUSPAY_LOCAL_HTTP: undefined }, { VERCEL: '1' }, { VERCEL_ENV: 'preview' }, { PRODUCT_PHOTOS_ENVIRONMENT: 'production' }, { DATABASE_URL: 'postgres://synthetic:synthetic@remote.invalid/synthetic' }, { PRODUCT_PHOTOS_LOCAL_TEST_STORE: '/etc' }])
      expect(() => photoConfig({ ...local, ...override })).toThrow()
  })
  it('adds only the exact accepted public origin to the image policy', () => {
    expect(configuredPhotoOrigin(env)).toBe(env.PRODUCT_PHOTOS_BLOB_PUBLIC_ORIGIN)
    expect(configuredPhotoOrigin({ ...env, PRODUCT_PHOTOS_BLOB_PUBLIC_ORIGIN: "https://other.invalid; script-src *" })).toBeNull()
    expect(configuredPhotoOrigin({ ...env, PRODUCT_PHOTOS_PUBLIC_ACCESS: undefined })).toBeNull()
  })
})
