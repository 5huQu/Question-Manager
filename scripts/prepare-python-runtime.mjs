import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = path.join(root, 'runtime')
const runtimeDir = path.join(runtimeRoot, 'python')
const cacheDir = path.join(runtimeRoot, 'cache')
const manifestPath = path.join(runtimeDir, 'question-runtime.json')
const requirementsPath = path.join(root, 'server', 'python', 'runtime-requirements.txt')

const runtimes = {
  'darwin-arm64': {
    archive: 'cpython-3.12.13+20260610-aarch64-apple-darwin-install_only_stripped.tar.gz',
    sha256: 'f0a7fa7decc75df2b1a789329a44f657c4a15c0a683f197ce46a5cb621bc6ef4',
  },
  'darwin-x64': {
    archive: 'cpython-3.12.13+20260610-x86_64-apple-darwin-install_only_stripped.tar.gz',
    sha256: 'c56c2dfe3fb5569430f4eabcff1fc1334c66db708bf17c103eef3dd237f3e3ab',
  },
  'win32-x64': {
    archive: 'cpython-3.12.13+20260610-x86_64-pc-windows-msvc-install_only_stripped.tar.gz',
    sha256: '99dce0b23bf3c3b28d350cdd7bfe3cd3be51cc4f285faae7c0df110d106d1a8d',
  },
}

const platformKey = `${process.platform}-${process.arch}`
const runtime = runtimes[platformKey]
if (!runtime) throw new Error(`Unsupported bundled Python target: ${platformKey}`)

const requirementsSha256 = sha256File(requirementsPath)
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (manifest.archive === runtime.archive && manifest.requirementsSha256 === requirementsSha256) {
    verifyRuntime()
    console.log(`Bundled Python is ready: ${runtimeDir}`)
    process.exit(0)
  }
}

fs.mkdirSync(cacheDir, { recursive: true })
const archivePath = path.join(cacheDir, runtime.archive)
const releaseTag = '20260610'
const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${releaseTag}/${encodeURIComponent(runtime.archive)}`

if (!fs.existsSync(archivePath) || sha256File(archivePath) !== runtime.sha256) {
  console.log(`Downloading ${runtime.archive}`)
  await download(url, archivePath)
}
if (sha256File(archivePath) !== runtime.sha256) throw new Error(`SHA-256 mismatch for ${runtime.archive}`)

const extractDir = path.join(runtimeRoot, `.extract-${process.pid}`)
fs.rmSync(extractDir, { recursive: true, force: true })
fs.mkdirSync(extractDir, { recursive: true })
run('tar', ['-xzf', archivePath, '-C', extractDir])

const extractedRuntime = path.join(extractDir, 'python')
if (!fs.existsSync(extractedRuntime)) throw new Error('Python archive did not contain the expected python directory')
fs.rmSync(runtimeDir, { recursive: true, force: true })
fs.renameSync(extractedRuntime, runtimeDir)
fs.rmSync(extractDir, { recursive: true, force: true })

const python = pythonExecutable()
run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-compile', '--only-binary=:all:', '--requirement', requirementsPath])
pruneCaches(runtimeDir)
fs.writeFileSync(manifestPath, `${JSON.stringify({
  archive: runtime.archive,
  archiveSha256: runtime.sha256,
  requirementsSha256,
  platform: process.platform,
  arch: process.arch,
  pythonVersion: '3.12.13',
}, null, 2)}\n`)
verifyRuntime()
console.log(`Bundled Python prepared at ${runtimeDir}`)

function pythonExecutable() {
  return process.platform === 'win32'
    ? path.join(runtimeDir, 'python.exe')
    : path.join(runtimeDir, 'bin', 'python3')
}

function verifyRuntime() {
  const code = [
    'import json, sys, importlib.metadata',
    'import fitz',
    'from PIL import Image',
    'import flask',
    'print(json.dumps({"python": sys.version.split()[0], "pymupdf": fitz.VersionBind, "pillow": Image.__version__, "flask": importlib.metadata.version("flask")}))',
  ].join('; ')
  run(pythonExecutable(), ['-I', '-c', code])
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status}`)
}

async function download(source, destination) {
  const partial = `${destination}.partial`
  fs.rmSync(partial, { force: true })
  const response = await fetch(source)
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status} ${response.statusText}`)
  const file = fs.createWriteStream(partial)
  for await (const chunk of response.body) file.write(chunk)
  await new Promise((resolve, reject) => file.end((error) => error ? reject(error) : resolve()))
  fs.renameSync(partial, destination)
}

function sha256File(filePath) {
  const hash = createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function pruneCaches(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__pycache__') fs.rmSync(entryPath, { recursive: true, force: true })
      else pruneCaches(entryPath)
    } else if (entry.name.endsWith('.pyc')) {
      fs.rmSync(entryPath, { force: true })
    }
  }
}
