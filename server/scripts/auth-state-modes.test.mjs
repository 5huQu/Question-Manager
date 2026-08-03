import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const projectRoot = path.resolve(new URL('../..', import.meta.url).pathname)

function runMode(mode, trustedProxy = 'off') {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), `question-manager-auth-${mode}-`))
  const script = `
    import fs from 'node:fs'
    import { app, closeDatabase } from './server/dist/index.js'
    const server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    const port = server.address().port
    try {
      const state = await fetch('http://127.0.0.1:' + port + '/api/auth/state')
      console.log(JSON.stringify(await state.json()))
      ${mode === 'single-admin' ? `
        const bootstrap = await fetch('http://127.0.0.1:' + port + '/api/auth/bootstrap', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:5174' },
          body: JSON.stringify({ username: 'admin', password: 'correct horse battery staple' }),
        })
        console.log('bootstrap=' + bootstrap.status)
        const login = await fetch('http://127.0.0.1:' + port + '/api/auth/login', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://127.0.0.1:5174',
            'x-forwarded-for': '198.51.100.7, 127.0.0.1',
          },
          body: JSON.stringify({ username: 'admin', password: 'correct horse battery staple' }),
        })
        const cookie = (login.headers.getSetCookie?.()[0] || login.headers.get('set-cookie') || '').split(';')[0]
        const sessions = await fetch('http://127.0.0.1:' + port + '/api/auth/sessions', { headers: { cookie } })
        console.log('loginIp=' + (await sessions.json()).sessions[0].loginIp)
      ` : ''}
    } finally {
      await new Promise((resolve) => server.close(resolve))
      closeDatabase()
      fs.rmSync(${JSON.stringify(dataRoot)}, { recursive: true, force: true })
    }
  `
  return execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: projectRoot,
    env: {
      ...process.env,
      QUESTION_DATA_DIR: dataRoot,
      QUESTION_AUTH_MODE: mode,
      AUTH_TRUSTED_PROXY: trustedProxy,
      PUBLIC_ORIGIN: 'http://127.0.0.1:5174',
      ADMIN_BOOTSTRAP_TOKEN: '',
    },
    encoding: 'utf8',
    timeout: 30_000,
  })
}

const singleAdminOutput = runMode('single-admin', 'loopback')
assert.match(singleAdminOutput, /"accountManagementAvailable":true/)
assert.match(singleAdminOutput, /bootstrap=201/, '未配置 ADMIN_BOOTSTRAP_TOKEN 时仍应允许初始化')
assert.match(singleAdminOutput, /loginIp=198\.51\.100\.7/, '可信 loopback 代理必须解析代理链中的客户端地址')

for (const mode of ['trusted-desktop', 'disabled']) {
  const output = runMode(mode)
  assert.match(output, /"accountManagementAvailable":false/, `${mode} 必须关闭账号管理能力`)
}

console.log('auth state mode tests passed')
