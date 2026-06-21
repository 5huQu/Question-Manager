import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pythonDetails } from './python.js'

export function firstExecutable(candidates: string[]) {
  for (const candidate of candidates.filter(Boolean)) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore', timeout: 3000 })
      return candidate
    } catch {
      // Try the next candidate.
    }
  }
  return ''
}

function configuredSofficePath() {
  return (process.env.SOFFICE_PATH || '').trim()
}

function windowsSofficeCandidates() {
  if (process.platform !== 'win32') return []
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  return [
    path.join(programFiles, 'LibreOffice', 'program', 'soffice.exe'),
    path.join(programFilesX86, 'LibreOffice', 'program', 'soffice.exe'),
    'soffice.exe',
  ]
}

export function sofficePath() {
  return firstExecutable([
    configuredSofficePath(),
    process.env.SOFFICE_PATH || '',
    process.platform === 'darwin' ? '/Applications/LibreOffice.app/Contents/MacOS/soffice' : '',
    ...windowsSofficeCandidates(),
    'soffice',
    'libreoffice',
  ])
}

export function xelatexPath() {
  return firstExecutable([
    process.env.XELATEX_PATH || '',
    'xelatex',
  ])
}

export function toolAvailability() {
  const resolvedSofficePath = sofficePath()
  return {
    python: pythonDetails(),
    xelatex: Boolean(xelatexPath()),
    soffice: Boolean(resolvedSofficePath),
    sofficePath: resolvedSofficePath,
  }
}
