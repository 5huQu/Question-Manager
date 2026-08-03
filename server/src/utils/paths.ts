import path from 'node:path'
import fs from 'node:fs'
import { storageRoot, sourceRoot } from '../config.js'

const publicImageExtensions = new Set(['.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp'])
const publicPreviewExtensions = new Set(['.pdf', '.png'])
const publicExportExtensions = new Set(['.pdf'])

type PublicAssetRule = {
  root: string
  extensions: ReadonlySet<string>
}

export function isInside(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function toPortablePath(value: string) {
  return value.split(path.sep).join('/')
}

export function assetPathFor(absPath: string) {
  const absolute = path.resolve(absPath)
  if (isInside(storageRoot, absolute)) return toPortablePath(path.relative(storageRoot, absolute))
  if (isInside(sourceRoot, absolute)) return toPortablePath(path.relative(sourceRoot, absolute))
  return toPortablePath(path.relative(storageRoot, absolute))
}

export function resolveStoragePath(rawPath: string) {
  const clean = stripAssetPrefix(String(rawPath || ''))
  if (!clean) return ''
  if (path.isAbsolute(clean)) return clean
  const storageCandidate = path.join(storageRoot, clean)
  if (fs.existsSync(storageCandidate) || storageRoot !== sourceRoot) return storageCandidate
  return path.join(sourceRoot, clean)
}

/**
 * Resolve a browser asset URL only when it points at an explicitly public
 * artifact. This is intentionally separate from resolveStoragePath(), which
 * is used internally and can resolve arbitrary application data.
 */
export function resolvePublicAssetPath(rawPath: string) {
  const clean = stripAssetPrefix(String(rawPath || ''))
  if (!clean || clean.includes('\0')) return ''
  const rawSegments = clean.split(/[\\/]+/)
  if (rawSegments.some((segment) => !segment || segment.startsWith('.'))) return ''

  const candidate = path.resolve(storageRoot, clean)
  if (!isInside(storageRoot, candidate)) return ''

  const relative = path.relative(storageRoot, candidate)
  const segments = relative.split(path.sep)
  if (segments.some((segment) => !segment || segment.startsWith('.'))) return ''

  const rule = publicAssetRule(segments)
  if (!rule) return ''

  let realStorageRoot: string
  let realRoot: string
  let realTarget: string
  try {
    realStorageRoot = fs.realpathSync.native(storageRoot)
    realRoot = fs.realpathSync.native(rule.root)
    realTarget = fs.realpathSync.native(candidate)
  } catch {
    return ''
  }

  // The allowlisted directory itself must not be a symlink to outside the
  // configured data root. Then re-check the resolved target against that
  // resolved directory to prevent symlink traversal.
  if (!isInside(realStorageRoot, realRoot) || !isInside(realRoot, realTarget)) return ''
  const realRelative = path.relative(realRoot, realTarget)
  if (realRelative.split(path.sep).some((segment) => !segment || segment.startsWith('.'))) return ''

  const extension = path.extname(realTarget).toLowerCase()
  if (!rule.extensions.has(extension)) return ''

  try {
    return fs.statSync(realTarget).isFile() ? realTarget : ''
  } catch {
    return ''
  }
}

function publicAssetRule(segments: string[]): PublicAssetRule | null {
  if (segments[0] === 'data' && segments[1] === 'question_figures' && segments.length >= 4) {
    return {
      root: path.join(storageRoot, 'data', 'question_figures'),
      extensions: publicImageExtensions,
    }
  }

  if (segments[0] === 'data' && segments[1] === 'import-flow-v2' && segments[2] === 'source-documents' && segments[4] === 'assets' && segments.length >= 6) {
    return {
      root: path.join(storageRoot, 'data', 'import-flow-v2', 'source-documents', segments[3], 'assets'),
      extensions: publicImageExtensions,
    }
  }

  if (segments[0] === 'data' && segments[1] === 'import-flow-v2' && segments[2] === 'candidate-figures' && segments.length >= 5) {
    return {
      root: path.join(storageRoot, 'data', 'import-flow-v2', 'candidate-figures', segments[3]),
      extensions: publicImageExtensions,
    }
  }

  if (segments[0] === 'data' && segments[1] === 'teaching-documents' && segments[3] === 'assets' && segments.length >= 5) {
    return {
      root: path.join(storageRoot, 'data', 'teaching-documents', segments[2], 'assets'),
      extensions: publicImageExtensions,
    }
  }

  if (segments[0] === 'data' && segments[1] === 'layout-drafts' && segments[3] === 'assets' && segments.length >= 5) {
    return {
      root: path.join(storageRoot, 'data', 'layout-drafts', segments[2], 'assets'),
      extensions: publicImageExtensions,
    }
  }

  if (segments[0] === 'data' && segments[1] === 'layout-previews' && segments.length >= 5) {
    return {
      root: path.join(storageRoot, 'data', 'layout-previews'),
      extensions: publicPreviewExtensions,
    }
  }

  if (segments[0] === 'data' && segments[1] === 'layout-preview-cache' && segments.length >= 4) {
    return {
      root: path.join(storageRoot, 'data', 'layout-preview-cache'),
      extensions: publicPreviewExtensions,
    }
  }

  if (segments[0] === 'output' && segments[1] === 'pdf' && ['collection-exports', 'examzh-exports'].includes(segments[2]) && segments.length >= 5) {
    return {
      root: path.join(storageRoot, 'output', 'pdf', segments[2]),
      extensions: publicExportExtensions,
    }
  }

  return null
}

export function stripAssetPrefix(value: string) {
  return value.replace(/^question_assets\//, '').replace(/^\/+/, '')
}
