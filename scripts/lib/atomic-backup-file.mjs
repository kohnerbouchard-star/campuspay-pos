import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** Publish only a complete, flushed archive; never overwrite a prior backup.
 * A same-directory hard link is atomic and exclusive, unlike rename-over-existing.
 * Interrupted writes can leave only an explicitly named .partial file.
 */
export function writeBackupAtomically(output, bytes, io = fs) {
  const destination = path.resolve(output)
  const directory = path.dirname(destination)
  const temporary = path.join(directory, `.${path.basename(destination)}.${randomUUID()}.partial`)
  let descriptor, created = false, failure
  try {
    descriptor = io.openSync(temporary, 'wx', 0o600)
    created = true
    io.writeFileSync(descriptor, bytes)
    io.fsyncSync(descriptor)
    io.closeSync(descriptor)
    descriptor = undefined
    io.linkSync(temporary, destination)
    // Flush the published directory entry as well as the archive contents.
    const directoryDescriptor = io.openSync(directory, 'r')
    try { io.fsyncSync(directoryDescriptor) }
    finally { io.closeSync(directoryDescriptor) }
  } catch (error) {
    failure = error
    throw error
  } finally {
    if (descriptor !== undefined) {
      try { io.closeSync(descriptor) } catch (error) { if (!failure) throw error }
    }
    if (created) {
      try { io.unlinkSync(temporary) }
      catch (error) { if (error.code !== 'ENOENT' && !failure) throw error }
    }
  }
}
