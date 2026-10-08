/** Header-only guard BEFORE the browser decodes a local preview. Server decoding
 * remains authoritative. This does not accept URLs or use an image decoder. */
export function previewDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const text = (at: number, count: number) => String.fromCharCode(...bytes.subarray(at, at + count))
  const checked = (width: number, height: number) => {
    if (!width || !height || width > 8192 || height > 8192 || width * height > 20_000_000)
      throw new Error('Image dimensions must be at most 8192 pixels per side and 20 megapixels in total.')
    return { width, height }
  }
  try {
    if (bytes.length >= 24 && bytes[0] === 137 && text(1, 3) === 'PNG' && text(12, 4) === 'IHDR')
      return checked(view.getUint32(16), view.getUint32(20))
    if (bytes[0] === 255 && bytes[1] === 216) {
      let offset = 2; let dimensions: { width: number; height: number } | undefined
      while (offset + 4 <= bytes.length) {
        if (bytes[offset++] !== 255) break
        while (bytes[offset] === 255) offset++
        const marker = bytes[offset++]
        if (marker === 218 && dimensions) return dimensions
        if (marker === 217) break
        if (marker === 1 || marker >= 208 && marker <= 215) continue
        const length = view.getUint16(offset)
        if (length < 2 || offset + length > bytes.length) break
        if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
          if (dimensions || length < 8) break
          dimensions = checked(view.getUint16(offset + 5), view.getUint16(offset + 3))
        }
        offset += length
      }
    }
    if (bytes.length >= 30 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
      let result: { width: number; height: number } | undefined
      for (let offset = 12; offset + 8 <= bytes.length;) {
        const chunk = text(offset, 4), size = view.getUint32(offset + 4, true), data = offset + 8
        if (data + size > bytes.length) break
        if (chunk === 'ANIM' || chunk === 'ANMF') throw new Error('Animated images are not supported. Choose a still image.')
        if (chunk === 'VP8X' && size >= 10) {
          if (bytes[data] & 2) throw new Error('Animated images are not supported. Choose a still image.')
          result = checked(1 + bytes[data + 4] + (bytes[data + 5] << 8) + (bytes[data + 6] << 16), 1 + bytes[data + 7] + (bytes[data + 8] << 8) + (bytes[data + 9] << 16))
        } else if (chunk === 'VP8 ' && size >= 10 && text(data + 3, 3) === '\x9d\x01\x2a') {
          result = checked(view.getUint16(data + 6, true) & 16383, view.getUint16(data + 8, true) & 16383)
        } else if (chunk === 'VP8L' && size >= 5 && bytes[data] === 47) {
          const value = view.getUint32(data + 1, true)
          result = checked((value & 16383) + 1, ((value >>> 14) & 16383) + 1)
        }
        offset = data + size + (size % 2)
      }
      if (result) return result
    }
  } catch (error) {
    if (error instanceof Error && !(error instanceof RangeError)) throw error
  }
  throw new Error('The image header could not be read. Choose a valid still JPEG, PNG or WebP.')
}
