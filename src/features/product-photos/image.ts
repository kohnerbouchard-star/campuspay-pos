import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { ApiError } from '@/lib/api/errors'
import { MAX_PHOTO_BYTES, type PhotoCrop } from './domain'

const MAX_DIMENSION = 8192
const MAX_PIXELS = 20_000_000
const options = { failOn: 'warning' as const, limitInputPixels: MAX_PIXELS, sequentialRead: true }
sharp.cache({ memory: 16, files: 0, items: 20 })
sharp.concurrency(1)
let processing = 0
export type ProcessedImage = { buffer: Buffer; width: number; height: number; bytes: number; sha256: string }
export type ProcessedPhoto = { display: ProcessedImage; thumbnail: ProcessedImage }
const invalid = (message: string) => new ApiError(400, 'BAD_REQUEST', message)

function format(bytes: Buffer): 'jpeg' | 'png' | 'webp' {
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg'
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  throw invalid('Choose a JPEG, PNG or WebP image. SVG, GIF and other formats are not supported.')
}

/** Fully decode into bounded raw pixels, then encode new files. No original bytes or metadata reach storage. */
export async function processPhoto(bytes: Buffer, crop: PhotoCrop, signal?: AbortSignal): Promise<ProcessedPhoto> {
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) throw invalid('Choose an image no larger than 4 MB.')
  if (processing >= 2) throw new ApiError(429, 'RATE_LIMITED', 'Image processing is busy. Retry shortly.')
  processing++
  try {
    signal?.throwIfAborted()
    const expected = format(bytes)
    const metadata = await sharp(bytes, options).timeout({ seconds: 3 }).metadata()
    if (metadata.format !== expected || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1)
      throw invalid('The image could not be read, or contains animation. Use a still JPEG, PNG or WebP.')
    if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION || metadata.width * metadata.height > MAX_PIXELS)
      throw invalid('Image dimensions must be at most 8192 pixels per side and 20 megapixels in total.')
    const decoder = sharp(bytes, options).rotate().toColourspace('srgb').ensureAlpha().raw().timeout({ seconds: 5 })
    const abort = () => decoder.destroy(new Error('Image decoding cancelled'))
    signal?.addEventListener('abort', abort, { once: true })
    const raw = await decoder.toBuffer({ resolveWithObject: true }).finally(() => signal?.removeEventListener('abort', abort))
    signal?.throwIfAborted()
    const { width, height, channels } = raw.info
    const square = Math.min(width, height)
    const extract = { left: Math.round((width - square) * crop.x / 100), top: Math.round((height - square) * crop.y / 100), width: square, height: square }
    async function encode(size: number, limit: number): Promise<ProcessedImage> {
      signal?.throwIfAborted()
      let encoder = sharp(raw.data, { raw: { width, height, channels }, limitInputPixels: MAX_PIXELS })
      if (crop.mode === 'square') encoder = encoder.extract(extract)
      const cancel = () => encoder.destroy(new Error('Image encoding cancelled'))
      signal?.addEventListener('abort', cancel, { once: true })
      try {
        const output = await encoder.resize(size, size, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82, effort: 3 }).timeout({ seconds: 4 }).toBuffer({ resolveWithObject: true })
        if (!output.data.length || output.data.length > limit) throw invalid('The processed image is too large. Choose a simpler or smaller image.')
        return { buffer: output.data, width: output.info.width, height: output.info.height, bytes: output.data.length,
          sha256: createHash('sha256').update(output.data).digest('hex') }
      } finally { signal?.removeEventListener('abort', cancel) }
    }
    const display = await encode(1280, 2_000_000)
    const thumbnail = await encode(384, 500_000)
    return { display, thumbnail }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw invalid(signal?.aborted ? 'Image upload was interrupted. Check its status before retrying.'
      : 'This image is damaged, unsupported, too large to decode, or took too long to process. Choose another JPEG, PNG or WebP.')
  } finally { processing-- }
}
