import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { stripAssetPrefix, resolveStoragePath } from '../paths.js'
import { pythonCommand } from '../../services/settings/python.js'

export function imageMimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  return 'image/png'
}

export function imageExtension(filename: string, mimeType: string) {
  const extension = path.extname(filename || '').toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension)) return extension
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'image/gif') return '.gif'
  return '.png'
}

export function figureAbsolutePath(figure: Record<string, any>) {
  const rawPath = stripAssetPrefix(String(figure.path || figure.sourcePath || ''))
  if (!rawPath) return ''
  return path.isAbsolute(rawPath) ? rawPath : resolveStoragePath(rawPath)
}

export function imageDimensions(imagePath: string) {
  return JSON.parse(execFileSync(pythonCommand(), [
    '-c',
    'from PIL import Image; import json, sys; im=Image.open(sys.argv[1]); print(json.dumps({"width": im.width, "height": im.height}))',
    imagePath,
  ], { encoding: 'utf8' })) as { width: number; height: number }
}
