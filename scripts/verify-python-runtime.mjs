import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const runtimeDir = path.resolve('runtime/python')
const python = process.platform === 'win32'
  ? path.join(runtimeDir, 'python.exe')
  : path.join(runtimeDir, 'bin', 'python3')

if (!fs.existsSync(python)) throw new Error(`Bundled Python is missing: ${python}`)
const code = [
  'import json, sys, importlib.metadata',
  'import fitz',
  'from PIL import Image',
  'print(json.dumps({"executable": sys.executable, "version": sys.version.split()[0], "pymupdf": fitz.VersionBind, "pillow": Image.__version__}))',
].join('; ')
const result = spawnSync(python, ['-I', '-c', code], {
  env: { ...process.env, PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' },
  encoding: 'utf8',
})
if (result.status !== 0) throw new Error(result.stderr || `Bundled Python exited with code ${result.status}`)
console.log(result.stdout.trim())
