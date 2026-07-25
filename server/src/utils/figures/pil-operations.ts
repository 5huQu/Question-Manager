import fs from 'node:fs'
import path from 'node:path'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { pythonCommand } from '../../services/settings/python.js'

const execFileAsync = promisify(execFile)

export function cropFigureImage(sourcePath: string, outputPath: string, bbox: Record<string, any>) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const cropScript = [
    'from PIL import Image',
    'import json, sys',
    'src, dst, raw = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])',
    'x = int(round(float(raw.get("x", raw.get("x0", 0)))))',
    'y = int(round(float(raw.get("y", raw.get("y0", 0)))))',
    'w = int(round(float(raw.get("width", raw.get("w", raw.get("x1", 0) - raw.get("x0", 0))))))',
    'h = int(round(float(raw.get("height", raw.get("h", raw.get("y1", 0) - raw.get("y0", 0))))))',
    'im = Image.open(src)',
    'x = max(0, min(x, im.width - 1)); y = max(0, min(y, im.height - 1))',
    'w = max(1, min(w, im.width - x)); h = max(1, min(h, im.height - y))',
    'im.crop((x, y, x + w, y + h)).save(dst)',
  ].join('; ')
  execFileSync(pythonCommand(), ['-c', cropScript, sourcePath, outputPath, JSON.stringify(bbox)], { encoding: 'utf8' })
}

export async function cropFigureImageAsync(sourcePath: string, outputPath: string, bbox: Record<string, any>) {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true })
  const cropScript = [
    'from PIL import Image', 'import json, sys', 'src, dst, raw = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])',
    'x = int(round(float(raw.get("x", raw.get("x0", 0)))))', 'y = int(round(float(raw.get("y", raw.get("y0", 0)))))',
    'w = int(round(float(raw.get("width", raw.get("w", raw.get("x1", 0) - raw.get("x0", 0))))))',
    'h = int(round(float(raw.get("height", raw.get("h", raw.get("y1", 0) - raw.get("y0", 0))))))',
    'im = Image.open(src)', 'x = max(0, min(x, im.width - 1)); y = max(0, min(y, im.height - 1))',
    'w = max(1, min(w, im.width - x)); h = max(1, min(h, im.height - y))', 'im.crop((x, y, x + w, y + h)).save(dst)',
  ].join('; ')
  await execFileAsync(pythonCommand(), ['-c', cropScript, sourcePath, outputPath, JSON.stringify(bbox)], { encoding: 'utf8' })
}

export async function splitReviewImage(sourcePath: string, topOutputPath: string, bottomOutputPath: string, splitRatio: number) {
  fs.mkdirSync(path.dirname(topOutputPath), { recursive: true })
  fs.mkdirSync(path.dirname(bottomOutputPath), { recursive: true })
  const splitScript = [
    'from PIL import Image',
    'import json, sys',
    'src, top_dst, bottom_dst, raw = sys.argv[1], sys.argv[2], sys.argv[3], json.loads(sys.argv[4])',
    'ratio = float(raw.get("splitRatio", 0.5))',
    'im = Image.open(src)',
    'y = int(round(im.height * ratio))',
    'y = max(8, min(y, im.height - 8))',
    'im.crop((0, 0, im.width, y)).save(top_dst)',
    'im.crop((0, y, im.width, im.height)).save(bottom_dst)',
    'print(json.dumps({"width": im.width, "height": im.height, "splitY": y, "topHeight": y, "bottomHeight": im.height - y}))',
  ].join('; ')
  const { stdout } = await execFileAsync(pythonCommand(), ['-c', splitScript, sourcePath, topOutputPath, bottomOutputPath, JSON.stringify({ splitRatio })], { encoding: 'utf8' })
  return JSON.parse(stdout)
}

export async function mergeReviewImages(sourcePaths: string[], outputPath: string) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const mergeScript = [
    'from PIL import Image',
    'import json, sys',
    'raw_paths, dst = json.loads(sys.argv[1]), sys.argv[2]',
    'images = [Image.open(path).convert("RGB") for path in raw_paths]',
    'width = max(im.width for im in images)',
    'height = sum(im.height for im in images)',
    'canvas = Image.new("RGB", (width, height), "white")',
    'y = 0',
    'parts = []',
    'for im, path in zip(images, raw_paths):',
    '    canvas.paste(im, (0, y))',
    '    parts.append({"path": path, "width": im.width, "height": im.height, "y": y})',
    '    y += im.height',
    'canvas.save(dst)',
    'print(json.dumps({"width": width, "height": height, "parts": parts}))',
  ].join('\n')
  const { stdout } = await execFileAsync(pythonCommand(), ['-c', mergeScript, JSON.stringify(sourcePaths), outputPath], { encoding: 'utf8' })
  return JSON.parse(stdout)
}
