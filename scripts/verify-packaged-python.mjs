import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const packageRoot = packagedRoot()
const resourcesRoot = process.platform === 'darwin'
  ? path.join(packageRoot, 'Contents', 'Resources')
  : path.join(packageRoot, 'resources')
const appRoot = path.join(resourcesRoot, 'app')
const python = process.platform === 'win32'
  ? path.join(resourcesRoot, 'python', 'python.exe')
  : path.join(resourcesRoot, 'python', 'bin', 'python3')
const renderer = path.join(appRoot, 'server', 'python', 'scripts', 'render_pdf_page.py')
const cropper = path.join(appRoot, 'server', 'python', 'scripts', 'crop_manual_annotation.py')

for (const required of [python, renderer, cropper]) {
  if (!fs.existsSync(required)) throw new Error(`Packaged file is missing: ${required}`)
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'question-packaged-python-'))
const inputPdf = path.join(tempRoot, 'smoke.pdf')
const outputDir = path.join(tempRoot, 'output')

try {
  const importCheck = [
    'import json, sys, importlib.metadata',
    'import fitz',
    'from PIL import Image',
    'print(json.dumps({"version": sys.version.split()[0], "executable": sys.executable, "pymupdf": fitz.VersionBind, "pillow": Image.__version__}))',
  ].join('; ')
  const pythonInfo = JSON.parse(run(python, ['-I', '-c', importCheck]).stdout)

  const createPdf = [
    'import fitz, sys',
    'doc = fitz.open()',
    'page = doc.new_page()',
    'page.insert_text((72, 72), "1. Solve x + 1 = 2.", fontsize=14)',
    'page.insert_text((72, 130), "2. Find the value of 2 + 3.", fontsize=14)',
    'doc.save(sys.argv[1])',
  ].join('; ')
  run(python, ['-I', '-c', createPdf, inputPdf])
  const renderedPage = path.join(outputDir, 'page.png')
  run(python, [renderer, inputPdf, '1', renderedPage, '--dpi', '72'])
  const regions = path.join(tempRoot, 'regions.json')
  fs.writeFileSync(regions, JSON.stringify([{ id: 'smoke', kind: 'problem', question_key: '1', segments: [{ page: 1, x: 0, y: 0, width: 0.8, height: 0.5 }] }]))
  const cropResult = JSON.parse(run(python, [cropper, '--pdf', inputPdf, '--regions-json-file', regions, '--output-dir', outputDir, '--dpi', '72']).stdout)
  if (!fs.existsSync(renderedPage) || !cropResult.results?.length) throw new Error('Packaged V2 PDF tools did not create expected images')
  console.log(JSON.stringify({
    python: pythonInfo,
    renderedPage,
    cropCount: cropResult.results.length,
  }))
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}

function packagedRoot() {
  if (process.platform === 'darwin') {
    const arch = process.arch === 'arm64' ? 'mac-arm64' : 'mac'
    return path.resolve('dist', arch, 'Question Manager.app')
  }
  if (process.platform === 'win32') return path.resolve('dist', 'win-unpacked')
  throw new Error(`Unsupported packaged verification platform: ${process.platform}`)
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: appRoot,
    env: {
      ...process.env,
      PATH: process.platform === 'win32' ? 'C:\\Windows\\System32' : '/usr/bin:/bin',
      PYTHONNOUSERSITE: '1',
      PYTHONDONTWRITEBYTECODE: '1',
    },
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} exited with code ${result.status}`)
  return result
}
