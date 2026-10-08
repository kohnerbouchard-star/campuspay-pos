import { apiFetch, ClientApiError } from '@/lib/api/client'
import { PhotoSnapshotSchema, type PhotoSnapshot, type PhotoCrop } from './domain'

export const photoEndpoint = (productId: string) => `/api/inventory/products/${encodeURIComponent(productId)}/photo`
export async function requestPhoto(productId: string, method: 'GET' | 'PUT' | 'DELETE' | 'CANCEL', requestId?: string, payload = {}): Promise<PhotoSnapshot | 'disabled'> {
  const endpoint = photoEndpoint(productId)
  const result = await apiFetch<unknown>(method === 'CANCEL' ? `${endpoint}/cancel` : method === 'GET' && requestId ? `${endpoint}?requestId=${encodeURIComponent(requestId)}` : endpoint,
    { method: method === 'CANCEL' ? 'POST' : method, ...(method === 'GET' ? {} : { body: JSON.stringify({ ...payload, requestId }) }), signal: AbortSignal.timeout(20_000) })
  if (method === 'GET' && typeof result === 'object' && result !== null && 'disabled' in result && result.disabled === true) return 'disabled'
  return PhotoSnapshotSchema.parse(result)
}
export function uploadPhoto(productId: string, file: File, metadata: { requestId: string; revision: number; reason: string; crop: PhotoCrop }, onProgress: (value: number) => void) {
  const xhr = new XMLHttpRequest()
  const endpoint = photoEndpoint(productId)
  const promise = new Promise<PhotoSnapshot>((resolve, reject) => {
    const uncertain = () => reject(new Error('The upload result is unknown. Check photo status or cancel the pending change before trying another image.'))
    xhr.open('POST', endpoint); xhr.timeout = 50_000
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.setRequestHeader('X-Photo-Metadata', encodeURIComponent(JSON.stringify(metadata)))
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.min(100, Math.round(event.loaded / event.total * 100))) }
    xhr.onerror = uncertain; xhr.ontimeout = uncertain; xhr.onabort = uncertain
    xhr.onload = () => {
      try {
        if (xhr.responseURL !== new URL(endpoint, window.location.origin).href) { uncertain(); return }
        const body = JSON.parse(xhr.responseText)
        if (xhr.status >= 200 && xhr.status < 300 && body?.ok === true) resolve(PhotoSnapshotSchema.parse(body.data))
        else if (body?.ok === false && typeof body.error?.message === 'string' && body.error.message.length <= 1000)
          reject(new ClientApiError(body.error.code, body.error.message, xhr.status))
        else uncertain()
      } catch { uncertain() }
    }
    xhr.send(file)
  })
  return { promise, abort: () => xhr.abort() }
}
