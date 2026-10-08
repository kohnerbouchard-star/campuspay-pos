import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
import { processPhoto } from './image'
import { previewDimensions } from './preview'
import { PhotoCropSchema } from './domain'

const crop = { mode: 'fit' as const, x: 50, y: 50 }
async function sample(format: 'jpeg' | 'png' | 'webp' = 'png', width = 96, height = 64) {
  return sharp({ create: { width, height, channels: 3, background: { r: 40, g: 100, b: 180 } } }).toFormat(format).toBuffer()
}
describe('real decoded product images', () => {
  for (const format of ['jpeg', 'png', 'webp'] as const) it(`accepts and re-encodes ${format} with no reliance on a filename or MIME`, async () => {
    const input = await sample(format)
    expect(previewDimensions(new Uint8Array(input))).toEqual({ width: 96, height: 64 })
    const result = await processPhoto(input, crop)
    for (const output of [result.display, result.thumbnail]) {
      const metadata = await sharp(output.buffer).metadata()
      expect(metadata.format).toBe('webp'); expect(output.width).toBe(96); expect(output.height).toBe(64)
      expect(output.bytes).toBe(output.buffer.length); expect(output.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(metadata.exif).toBeUndefined(); expect(metadata.icc).toBeUndefined(); expect(metadata.xmp).toBeUndefined()
    }
  })
  it('strips orientation/EXIF/GPS and normalizes orientation before cropping', async () => {
    const original = await sharp(await sample('jpeg', 160, 80)).withMetadata({ orientation: 6 })
      .withExif({ IFD0: { Artist: 'Synthetic fixture only' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '0/1 0/1 0/1' } }).jpeg().toBuffer()
    const result = await processPhoto(original, crop)
    expect(result.display.width).toBe(80); expect(result.display.height).toBe(160)
    const metadata = await sharp(result.display.buffer).metadata()
    expect(metadata.exif).toBeUndefined(); expect(metadata.orientation).toBeUndefined()
  })
  it('bounds display and thumbnail dimensions and keeps aspect ratio', async () => {
    const result = await processPhoto(await sample('jpeg', 2400, 1200), crop)
    expect([result.display.width, result.display.height]).toEqual([1280, 640])
    expect([result.thumbnail.width, result.thumbnail.height]).toEqual([384, 192])
  })
  it('crops to a keyboard-selected square position in oriented pixel coordinates', async () => {
    const left = Buffer.alloc(100 * 100 * 3); const right = Buffer.alloc(100 * 100 * 3)
    for (let i = 0; i < left.length; i += 3) { left[i] = 240; right[i + 2] = 240 }
    const original = await sharp({ create: { width: 200, height: 100, channels: 3, background: 'white' } })
      .composite([{ input: left, raw: { width: 100, height: 100, channels: 3 }, left: 0, top: 0 }, { input: right, raw: { width: 100, height: 100, channels: 3 }, left: 100, top: 0 }]).png().toBuffer()
    const output = await processPhoto(original, { mode: 'square', x: 100, y: 50 })
    expect([output.display.width, output.display.height]).toEqual([100, 100])
    const pixel = await sharp(output.display.buffer).resize(1, 1).removeAlpha().raw().toBuffer()
    expect(pixel[2]).toBeGreaterThan(220); expect(pixel[0]).toBeLessThan(20)
  })
  it('rejects SVG, GIF, HTML, empty and corrupted content regardless of extension', async () => {
    for (const bytes of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.from('GIF89a'), Buffer.from('<html>photo.jpg</html>'), Buffer.alloc(0), Buffer.from([255,216,255,0,0])])
      await expect(processPhoto(bytes, crop)).rejects.toThrow()
    const truncated = (await sample()).subarray(0, 45)
    await expect(processPhoto(truncated, crop)).rejects.toThrow()
  })
  it('rejects over-4MB inputs before decoding', async () => {
    await expect(processPhoto(Buffer.alloc(4_000_001), crop)).rejects.toThrow('4 MB')
  })
  it('rejects dimensions and decompression pixel bombs', async () => {
    const wide = await sample('png', 8193, 1)
    expect(() => previewDimensions(new Uint8Array(wide))).toThrow('8192')
    await expect(processPhoto(wide, crop)).rejects.toThrow('8192')
    await expect(processPhoto(await sample('png', 4500, 4500), crop)).rejects.toThrow()
  })
  it('rejects real animated WebP', async () => {
    const fixture = JSON.parse(await readFile('scripts/product-photo-fixtures.json', 'utf8'))
    const bytes = Buffer.from(fixture.animated_webp, 'base64')
    expect((await sharp(bytes).metadata()).pages).toBe(2)
    expect(() => previewDimensions(new Uint8Array(bytes))).toThrow('Animated')
    await expect(processPhoto(bytes, crop)).rejects.toThrow('animation')
  })
  it('honors cancellation and bounds process concurrency', async () => {
    const bytes = await sample('jpeg', 1800, 1200)
    const controller = new AbortController(); controller.abort()
    await expect(processPhoto(bytes, crop, controller.signal)).rejects.toThrow('interrupted')
    const first = processPhoto(bytes, crop); const second = processPhoto(bytes, crop)
    await expect(processPhoto(bytes, crop)).rejects.toThrow('busy')
    await Promise.all([first, second])
    await expect(processPhoto(bytes, crop)).resolves.toHaveProperty('display')
  })
  it('rejects non-finite, out-of-range and injected crop inputs', () => {
    for (const input of [{ ...crop, x: -1 }, { ...crop, y: 101 }, { ...crop, mode: 'remote' }, { ...crop, x: NaN }, { ...crop, url: 'https://example.invalid/' }])
      expect(PhotoCropSchema.safeParse(input).success).toBe(false)
  })
})
