import { execFileSync } from 'node:child_process'

export function pythonCommand() {
  return process.env.PYTHON_PATH || (process.platform === 'win32' ? 'python' : 'python3')
}

export function pythonEnv(extra: NodeJS.ProcessEnv = {}) {
  return {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    ...extra,
  }
}

export function pythonDetails() {
  const command = pythonCommand()
  try {
    const code = [
      'import json, sys, importlib.metadata, importlib.util',
      'import fitz',
      'from PIL import Image',
      'flask_version = importlib.metadata.version("flask") if importlib.util.find_spec("flask") else ""',
      'print(json.dumps({"version": sys.version.split()[0], "executable": sys.executable, "pymupdf": fitz.VersionBind, "pillow": Image.__version__, "flask": flask_version}))',
    ].join('; ')
    const value = JSON.parse(
      execFileSync(command, ['-c', code], {
        env: pythonEnv(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      }),
    )
    return { available: true, source: process.env.QUESTION_PYTHON_RUNTIME || 'system', ...value }
  } catch (error) {
    const execError = error as { stderr?: unknown; message?: string }
    const stderr = Buffer.isBuffer(execError.stderr) ? execError.stderr.toString('utf8') : String(execError.stderr || '')
    return {
      available: false,
      source: process.env.QUESTION_PYTHON_RUNTIME || 'system',
      executable: command,
      error: stderr.trim() || (error instanceof Error ? error.message : String(error)),
    }
  }
}
