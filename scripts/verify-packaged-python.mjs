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
const cutter = path.join(appRoot, 'server', 'python', 'scripts', 'run_cut_for_question.py')

for (const required of [python, cutter]) {
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
    'import flask',
    'print(json.dumps({"version": sys.version.split()[0], "executable": sys.executable, "pymupdf": fitz.VersionBind, "pillow": Image.__version__, "flask": importlib.metadata.version("flask")}))',
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
  run(python, [cutter, '--input-pdf', inputPdf, '--output-dir', outputDir, '--asset-root', tempRoot, '--dpi', '72'])

  const result = JSON.parse(fs.readFileSync(path.join(outputDir, 'cut_results.json'), 'utf8'))
  if (result.summary?.failed_pdfs?.length) throw new Error(JSON.stringify(result.summary.failed_pdfs))
  if (!Array.isArray(result.results)) throw new Error('Packaged cutter did not write a results array')
  console.log(JSON.stringify({
    python: pythonInfo,
    questionCount: result.results.length,
    cutResults: path.join(outputDir, 'cut_results.json'),
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
