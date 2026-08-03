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

export function xelatexPath() {
  return firstExecutable([
    process.env.XELATEX_PATH || '',
    'xelatex',
  ])
}

export function dvisvgmPath() {
  return firstExecutable([process.env.DVISVGM_PATH || '', 'dvisvgm'])
}

export function toolAvailability() {
  return {
    python: pythonDetails(),
    xelatex: Boolean(xelatexPath()),
    dvisvgm: Boolean(dvisvgmPath()),
  }
}
