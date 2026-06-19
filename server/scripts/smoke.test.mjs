import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'question-manager-'))
process.env.QUESTION_DATA_DIR = tempRoot
process.env.PORT = '0'

const { closeDatabase, startServer } = await import('../dist/index.js')
const server = startServer(0)

try {
  if (!server.listening) await once(server, 'listening')
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const settingsResponse = await fetch(`http://127.0.0.1:${port}/api/settings`)
  if (!settingsResponse.ok) throw new Error(`settings check failed: HTTP ${settingsResponse.status}`)
  const initialSettings = await settingsResponse.json()
  if (initialSettings.setupCompleted !== false) throw new Error('new data directory should require first-run setup')

  const savedSettingsResponse = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ setupCompleted: true, systemName: 'Smoke Test' }),
  })
  if (!savedSettingsResponse.ok) throw new Error(`settings save failed: HTTP ${savedSettingsResponse.status}`)
  const savedSettings = await savedSettingsResponse.json()
  if (!savedSettings.setupCompleted) throw new Error('first-run setup completion was not persisted')
  if (savedSettings.systemName !== 'Smoke Test') throw new Error('first-run settings were not persisted')

  const response = await fetch(`http://127.0.0.1:${port}/api/health`)
  if (!response.ok) throw new Error(`health check failed: HTTP ${response.status}`)
  const payload = await response.json()
  if (!payload.ok) throw new Error('health check did not return ok=true')
  const sqlitePath = path.join(tempRoot, 'data', 'question.sqlite')
  if (!fs.existsSync(sqlitePath)) throw new Error(`sqlite database was not created: ${sqlitePath}`)
  const settingsPath = path.join(tempRoot, 'config', 'app_settings.json')
  if (!fs.existsSync(settingsPath)) throw new Error(`app settings were not created: ${settingsPath}`)
  console.log('smoke ok')
} finally {
  await new Promise((resolve) => server.close(resolve))
  closeDatabase()
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
