import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'question-workbench-'))
process.env.QUESTION_DATA_DIR = tempRoot
process.env.PORT = '0'

const { startServer } = await import('../dist/index.js')
const server = startServer(0)

try {
  if (!server.listening) await once(server, 'listening')
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const response = await fetch(`http://127.0.0.1:${port}/api/health`)
  if (!response.ok) throw new Error(`health check failed: HTTP ${response.status}`)
  const payload = await response.json()
  if (!payload.ok) throw new Error('health check did not return ok=true')
  const sqlitePath = path.join(tempRoot, 'data', 'question.sqlite')
  if (!fs.existsSync(sqlitePath)) throw new Error(`sqlite database was not created: ${sqlitePath}`)
  console.log('smoke ok')
} finally {
  await new Promise((resolve) => server.close(resolve))
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
