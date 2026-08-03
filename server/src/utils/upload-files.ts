import fs from 'node:fs'
import path from 'node:path'

export function removeFileQuietly(filePath: string | undefined) {
  if (!filePath) return
  try {
    fs.rmSync(filePath, { force: true })
  } catch {
    // Stale upload cleanup will retry this file on a later startup.
  }
}

/**
 * Move a file without buffering its contents. Files in the normal upload
 * path share QUESTION_DATA_DIR, so this is usually just a metadata operation.
 */
export function moveFileAtomic(source: string, target: string) {
  fs.mkdirSync(path.dirname(target), { recursive: true })

  try {
    fs.renameSync(source, target)
    return
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EXDEV') throw error
  }

  const temporaryTarget = `${target}.tmp-${process.pid}-${Date.now()}`
  try {
    fs.copyFileSync(source, temporaryTarget, fs.constants.COPYFILE_EXCL)
    fs.renameSync(temporaryTarget, target)
    fs.rmSync(source, { force: true })
  } catch (error) {
    fs.rmSync(temporaryTarget, { force: true })
    throw error
  }
}

export function cleanupStaleUploads(
  directory: string,
  maxAgeMs = 24 * 60 * 60 * 1000,
) {
  if (!fs.existsSync(directory)) return

  const cutoff = Date.now() - maxAgeMs
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue

    const target = path.join(directory, entry.name)
    try {
      const stat = fs.statSync(target)
      if (stat.mtimeMs < cutoff) fs.rmSync(target, { force: true })
    } catch {
      // Leave files that are being written or otherwise temporarily locked.
    }
  }
}

export function readFileHeader(filePath: string, bytes = 16) {
  const fd = fs.openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(bytes)
    const length = fs.readSync(fd, buffer, 0, bytes, 0)
    return buffer.subarray(0, length)
  } finally {
    fs.closeSync(fd)
  }
}
