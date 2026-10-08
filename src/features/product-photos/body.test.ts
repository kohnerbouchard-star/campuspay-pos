import { describe, it, expect, vi } from 'vitest'
import { boundedBody, photoUploadMetadata, photoJson } from './body'
import { PhotoRequestSchema } from './domain'

function request(body: BodyInit, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/photo', { method: 'POST', body, headers, duplex: 'half' } as RequestInit)
}
describe('bounded photo request parser', () => {
  it('counts actual stream bytes, not just claimed length', async () => {
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8)); controller.enqueue(new Uint8Array(8)); controller.close() } })
    await expect(boundedBody(request(stream), 10)).rejects.toThrow('4 MB')
    await expect(boundedBody(request('123', { 'content-length': '99' }), 10)).rejects.toThrow('limit')
    await expect(boundedBody(request('123', { 'content-length': '4' }), 10)).rejects.toThrow('incomplete')
    expect((await boundedBody(request('123'), 10)).toString()).toBe('123')
  })
  it('rejects compressed bodies, invalid JSON and caller-controlled paths', async () => {
    await expect(boundedBody(request('123', { 'content-encoding': 'gzip' }), 10)).rejects.toThrow('Compressed')
    await expect(photoJson(request('<html>'), PhotoRequestSchema)).rejects.toThrow('Check the photo')
    await expect(photoJson(request(JSON.stringify({ requestId: 'a1000000-0000-4000-8000-000000000001', url: 'https://other.invalid/' })), PhotoRequestSchema)).rejects.toThrow()
  })
  it('cancels an interrupted stream and rejects a stalled body at the deadline', async () => {
    const abort = new AbortController(), cancelled = vi.fn()
    const body = new ReadableStream({ cancel: cancelled })
    const interrupted = boundedBody(new Request('http://localhost/api/photo', { method: 'POST', body, signal: abort.signal, duplex: 'half' } as RequestInit), 10)
    const rejected = expect(interrupted).rejects.toThrow('interrupted')
    abort.abort(); await rejected; expect(cancelled).toHaveBeenCalledTimes(1)
    vi.useFakeTimers()
    try {
      const cancel = vi.fn()
      const pending = boundedBody(request(new ReadableStream({ cancel })), 10)
      const failure = expect(pending).rejects.toThrow('too long')
      await vi.advanceTimersByTimeAsync(10_000); await failure
      expect(cancel).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })
  it('requires bounded strict metadata and no upload filename or URL', () => {
    const metadata = { requestId: 'a1000000-0000-4000-8000-000000000001', revision: 0, reason: 'Synthetic photo test', crop: { mode: 'fit', x: 50, y: 50 } }
    expect(photoUploadMetadata(request('bytes', { 'content-type': 'application/octet-stream', 'x-photo-metadata': encodeURIComponent(JSON.stringify(metadata)) }))).toEqual(metadata)
    expect(() => photoUploadMetadata(request('bytes', { 'content-type': 'application/octet-stream', 'x-photo-metadata': 'x'.repeat(4097) }))).toThrow()
    expect(() => photoUploadMetadata(request('bytes', { 'content-type': 'image/jpeg' }))).toThrow()
  })
})
