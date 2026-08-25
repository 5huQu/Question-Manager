import fs from 'node:fs/promises'
import path from 'node:path'

export async function skinFilesIn(root) {
  const files = []
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(fullPath)
      else if (entry.isFile() && entry.name === 'skin.ts') files.push(fullPath)
    }
  }
  await visit(root)
  return files.sort()
}

export async function presetFilesIn(root) {
  const files = []
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(fullPath)
      else if (entry.isFile() && entry.name === 'preset.ts') files.push(fullPath)
    }
  }
  await visit(path.join(root, 'presets')).catch((error) => { if (error?.code !== 'ENOENT') throw error })
  return files.sort()
}

export async function cssFilesForSkin(skinFile) {
  const directory = path.dirname(skinFile)
  const entries = await fs.readdir(directory, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.css'))
    .map((entry) => path.join(directory, entry.name))
    .sort()
}

export function relativeTo(root, file) {
  return path.relative(root, file).split(path.sep).join('/')
}

export function isCustomSkin(root, skinFile) {
  return relativeTo(root, skinFile).startsWith('custom/')
}

export async function resolveSkinPath(root, pathOption) {
  if (!pathOption) return null
  const candidate = path.resolve(process.cwd(), pathOption)
  const resolvedRoot = path.resolve(root)
  if (candidate !== resolvedRoot && !candidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('--path must remain inside the teaching skins directory.')
  }
  const stat = await fs.stat(candidate).catch(() => null)
  if (!stat) throw new Error(`Skin path does not exist: ${pathOption}`)
  if (stat.isFile()) {
    if (path.basename(candidate) !== 'skin.ts') throw new Error('--path file must be skin.ts.')
    return new Set([candidate])
  }
  const files = await skinFilesIn(candidate)
  if (!files.length) throw new Error(`No skin.ts found under: ${pathOption}`)
  return new Set(files)
}
