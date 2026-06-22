import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')

const child = spawn(process.execPath, [tsxCli, 'watch', 'server/src/index.ts'], {
  cwd: root,
  // Some preview tools inject PORT for the frontend (usually 5174).  The API
  // server must not inherit it, otherwise it races Vite for the same port.
  env: { ...process.env, PORT: process.env.QUESTION_SERVER_PORT || '8797' },
  stdio: 'inherit',
})

child.on('error', (error) => {
  console.error('无法启动开发服务器：', error.message)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
