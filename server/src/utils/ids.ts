import path from 'node:path'

export function nowIso() {
  return new Date().toISOString()
}

export function safeName(value: string) {
  return (value || 'file')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'file'
}

export function createId(prefix: string, name = '') {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const suffix = Math.random().toString(16).slice(2, 8)
  const safe = name ? `_${safeName(name)}` : ''
  return `${prefix}_${stamp}_${suffix}${safe}`
}

export function isWordUploadKind(kind: string) {
  return kind === 'doc' || kind === 'docx'
}
