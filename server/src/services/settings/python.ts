import { execFileSync } from 'node:child_process'

export function pythonCommand() {
  return process.env.PYTHON_PATH || (process.platform === 'win32' ? 'python' : 'python3')
}

export function pythonDetails() {
  const command = pythonCommand()
  try {
    const code = [
      'import json, sys, importlib.metadata',
      'import fitz',
      'from PIL import Image',
      'import flask',
      'print(json.dumps({"version": sys.version.split()[0], "executable": sys.executable, "pymupdf": fitz.VersionBind, "pillow": Image.__version__, "flask": importlib.metadata.version("flask")}))',
    ].join('; ')
    const value = JSON.parse(
      execFileSync(command, ['-I', '-c', code], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000,
      }),
    )
    return { available: true, source: process.env.QUESTION_PYTHON_RUNTIME || 'system', ...value }
  } catch (error) {
    return {
      available: false,
      source: process.env.QUESTION_PYTHON_RUNTIME || 'system',
      executable: command,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
