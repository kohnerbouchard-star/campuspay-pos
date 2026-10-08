import { z, type ZodType } from 'zod'
import { ApiError } from '@/lib/api/errors'
import { MAX_PHOTO_BYTES, PhotoCropSchema, PhotoEditSchema } from './domain'

export async function boundedBody(request: Request, maximum: number): Promise<Buffer> {
  if (request.signal.aborted) throw new ApiError(408, 'BAD_REQUEST', 'The upload was interrupted.')
  if (request.headers.has('content-encoding')) throw new ApiError(415, 'BAD_REQUEST', 'Compressed request bodies are not supported.')
  const length = request.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum))
    throw new ApiError(413, 'BAD_REQUEST', `Request exceeds the ${maximum === MAX_PHOTO_BYTES ? '4 MB image' : 'small metadata'} limit.`)
  const reader = request.body?.getReader()
  if (!reader) throw new ApiError(400, 'BAD_REQUEST', 'Choose an image or supply the required operation.')
  const parts: Uint8Array[] = []; let received = 0
  let timedOut = false
  const timeout = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}) }, 10_000)
  const abort = () => { void reader.cancel().catch(() => {}) }
  request.signal.addEventListener('abort', abort, { once: true })
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (timedOut || request.signal.aborted) throw new ApiError(408, 'BAD_REQUEST', 'The upload was interrupted or took too long.')
      if (done) break
      received += value.byteLength
      if (received > maximum) throw new ApiError(413, 'BAD_REQUEST', 'Choose an image no larger than 4 MB.')
      parts.push(value)
    }
    if (length !== null && received !== Number(length)) throw new ApiError(400, 'BAD_REQUEST', 'The upload was incomplete.')
    return Buffer.concat(parts, received)
  } finally {
    clearTimeout(timeout); request.signal.removeEventListener('abort', abort)
    void reader.cancel().catch(() => {})
  }
}
export async function photoJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  try { return schema.parse(JSON.parse((await boundedBody(request, 4096)).toString('utf8'))) }
  catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(400, 'BAD_REQUEST', 'Check the photo operation, revision and 10–500 character reason.')
  }
}
export function photoUploadMetadata(request: Request) {
  try {
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/octet-stream') throw new Error('body')
    const encoded = request.headers.get('x-photo-metadata') ?? ''
    if (encoded.length > 4096) throw new Error('size')
    return PhotoEditSchema.extend({ crop: PhotoCropSchema }).strict().parse(JSON.parse(decodeURIComponent(encoded)))
  } catch { throw new ApiError(400, 'BAD_REQUEST', 'Check the photo, crop and 10–500 character reason.') }
}
export function photoId(value: string): string {
  const id = z.uuid().safeParse(value)
  if (!id.success) throw new ApiError(400, 'BAD_REQUEST', 'Invalid product photo identity')
  return id.data
}
