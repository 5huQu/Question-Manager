import path from 'node:path'
import fs from 'node:fs'
import { storageRoot, sourceRoot } from '../config.js'

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

export function stripAssetPrefix(value: string) {
  return value.replace(/^question_assets\//, '').replace(/^\/+/, '')
}
