import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from '../../config.js'
import { parseJson } from '../../utils/json.js'
import { resolveStoragePath } from '../../utils/paths.js'

export function importDataDir() {
  const dir = path.join(dataDir, 'import-flow-v2')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
}

export function writeJson(filePath: string, value: unknown) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8')
}

export function writeText(filePath: string, value: string) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, value, 'utf8')
}

export function readText(portablePath: string) {
  const target = resolveStoragePath(portablePath)
  if (!target || !fs.existsSync(target)) return ''
  return fs.readFileSync(target, 'utf8')
}

export function readJsonFile<T>(portablePath: string, fallback: T): T {
  const target = resolveStoragePath(portablePath)
  if (!target || !fs.existsSync(target)) return fallback
  return parseJson<T>(fs.readFileSync(target, 'utf8'), fallback)
}

export function storedOcrDocumentDir(id: string) {
  return path.join(importDataDir(), 'ocr-documents', id)
}

export function sourceDocumentDir(id: string) {
  return path.join(importDataDir(), 'source-documents', id)
}
