import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('server-only', () => ({}))
const { put, del } = vi.hoisted(() => ({ put: vi.fn(), del: vi.fn() }))
vi.mock('@vercel/blob', () => ({ put, del }))
import { photoStorage } from './storage'
import { photoKeys, type PhotoConfig } from './config'

const config: PhotoConfig = { namespace: 'test/synthetic-test', origin: 'https://synthetic.public.blob.vercel-storage.com', token: `${['vercel', 'blob', 'rw', 'synthetic'].join('_')}_${'synthetic'.repeat(4)}` }
const product = 'a1000000-0000-4000-8000-000000000001', asset = 'b1000000-0000-4000-8000-000000000001'
const image = { buffer: Buffer.from('synthetic-processed-bytes'), width: 1, height: 1, bytes: 28, sha256: 'a'.repeat(64) }
beforeEach(() => { put.mockReset(); del.mockReset(); put.mockImplementation(async (key: string) => ({ pathname: key, url: `${config.origin}/${key}` })); del.mockResolvedValue(undefined) })
describe('Vercel Blob adapter contract', () => {
  it('publishes only two generated immutable WebP keys with no overwrite', async () => {
    await photoStorage(config).store(product, asset, { display: image, thumbnail: image }, new AbortController().signal)
    expect(put).toHaveBeenCalledTimes(2)
    for (const [path, bytes, options] of put.mock.calls) {
      expect(path).toMatch(new RegExp(`^campuspay-products/test/synthetic-test/${product}/${asset}/(display|thumbnail)\\.webp$`))
      expect(bytes).toBe(image.buffer); expect(options).toMatchObject({ contentType: 'image/webp', access: 'public', addRandomSuffix: false, allowOverwrite: false, cacheControlMaxAge: 60 })
      expect(options.abortSignal).toBeInstanceOf(AbortSignal)
    }
  })
  it('rejects provider store/path mismatch and does not delete on ambiguous PUT failure', async () => {
    put.mockResolvedValue({ pathname: 'unrelated.webp', url: 'https://other.public.blob.vercel-storage.com/unrelated.webp' })
    await expect(photoStorage(config).store(product, asset, { display: image, thumbnail: image }, new AbortController().signal)).rejects.toThrow('does not match')
    expect(del).not.toHaveBeenCalled()
    put.mockRejectedValue(new Error('simulated transport loss'))
    await expect(photoStorage(config).store(product, asset, { display: image, thumbnail: image }, new AbortController().signal)).rejects.toThrow()
    expect(del).not.toHaveBeenCalled()
  })
  it('deletes only database-owned keys in the configured store and rejects path traversal', async () => {
    await photoStorage(config).remove(product, asset)
    expect(del.mock.calls[0][0]).toEqual(Object.values(photoKeys(config, product, asset)).map(key => `${config.origin}/${key}`))
    expect(del.mock.calls[0][1].abortSignal).toBeInstanceOf(AbortSignal)
    await expect(photoStorage(config).remove('../another-store', asset)).rejects.toThrow()
    expect(del).toHaveBeenCalledTimes(1)
  })
})
