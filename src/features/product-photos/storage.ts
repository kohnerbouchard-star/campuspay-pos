import 'server-only'
import { put, del } from '@vercel/blob'
import { ApiError } from '@/lib/api/errors'
import { photoKeys, validatePhotoStoreToken, type PhotoConfig } from './config'
import type { ProcessedPhoto } from './image'

export interface PhotoStorage {
  store(productId: string, assetId: string, photo: ProcessedPhoto, signal: AbortSignal): Promise<void>
  remove(productId: string, assetId: string): Promise<void>
}
/** All callers supply database-owned identities, never a filename, arbitrary URL or object path. */
export function photoStorage(config: PhotoConfig): PhotoStorage {
  const keys = (product: string, asset: string) => photoKeys(config, product, asset)
  if (config.testDirectory) {
    // This branch is protected by photoConfig's CI/loopback/non-Vercel checks.
    const directory = config.testDirectory
    return {
      async store(product, asset, images, signal) {
        const { mkdir, writeFile } = await import('node:fs/promises')
        for (const [kind, key] of Object.entries(keys(product, asset))) {
          signal.throwIfAborted()
          const path = `${directory}/${key}`
          await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true })
          await writeFile(path, images[kind as keyof ProcessedPhoto].buffer, { flag: 'wx', mode: 0o600, signal })
        }
      },
      async remove(product, asset) {
        const { unlink } = await import('node:fs/promises')
        for (const key of Object.values(keys(product, asset))) {
          try { await unlink(`${directory}/${key}`) }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        }
      },
    }
  }
  validatePhotoStoreToken(config.origin, config.token)
  return {
    async store(product, asset, images, signal) {
      for (const [kind, key] of Object.entries(keys(product, asset))) {
        const result = await put(key, images[kind as keyof ProcessedPhoto].buffer, {
          token: config.token, access: 'public', addRandomSuffix: false, allowOverwrite: false,
          contentType: 'image/webp', cacheControlMaxAge: 60,
          abortSignal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        })
        if (result.url !== `${config.origin}/${key}` || result.pathname !== key)
          throw new ApiError(503, 'CONNECTION_NOT_CONFIGURED', 'Photo storage does not match its configured application store. Nothing was linked.')
      }
    },
    async remove(product, asset) {
      // Exact configured origin plus a generated application/product/asset key only.
      await del(Object.values(keys(product, asset)).map(key => `${config.origin}/${key}`), {
        token: config.token, abortSignal: AbortSignal.timeout(10_000),
      })
    },
  }
}
