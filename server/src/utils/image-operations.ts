import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { pythonCommand } from '../services/settings/python.js'
import { resolveStoragePath, stripAssetPrefix } from './paths.js'

const execFileAsync = promisify(execFile)

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

export function figureAbsolutePath(figure: Record<string, unknown>) {
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

function cropScript() {
  return [
    'from PIL import Image', 'import json, sys', 'src, dst, raw = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])',
    'x = int(round(float(raw.get("x", raw.get("x0", 0)))))', 'y = int(round(float(raw.get("y", raw.get("y0", 0)))))',
    'w = int(round(float(raw.get("width", raw.get("w", raw.get("x1", 0) - raw.get("x0", 0))))))', 'h = int(round(float(raw.get("height", raw.get("h", raw.get("y1", 0) - raw.get("y0", 0))))))',
    'im = Image.open(src)', 'x = max(0, min(x, im.width - 1)); y = max(0, min(y, im.height - 1))',
    'w = max(1, min(w, im.width - x)); h = max(1, min(h, im.height - y))', 'im.crop((x, y, x + w, y + h)).save(dst)',
  ].join('; ')
}

export function cropFigureImage(sourcePath: string, outputPath: string, bbox: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  execFileSync(pythonCommand(), ['-c', cropScript(), sourcePath, outputPath, JSON.stringify(bbox)], { encoding: 'utf8' })
}

export async function cropFigureImageAsync(sourcePath: string, outputPath: string, bbox: Record<string, unknown>) {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true })
  await execFileAsync(pythonCommand(), ['-c', cropScript(), sourcePath, outputPath, JSON.stringify(bbox)], { encoding: 'utf8' })
}
