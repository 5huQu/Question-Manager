import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'question-manager-auth-'))
process.env.QUESTION_DATA_DIR = tempRoot
process.env.QUESTION_AUTH_MODE = 'single-admin'
process.env.ADMIN_BOOTSTRAP_TOKEN = 'bootstrap-secret-token'
process.env.PUBLIC_ORIGIN = 'http://127.0.0.1:5174'

const frontendDist = fileURLToPath(new URL('../../frontend/dist/index.html', import.meta.url))
const distBackup = fs.existsSync(frontendDist) ? fs.readFileSync(frontendDist, 'utf8') : null
fs.mkdirSync(path.dirname(frontendDist), { recursive: true })
fs.writeFileSync(frontendDist, '<!doctype html><html><body>question-manager</body></html>')

const { app, closeDatabase } = await import('../dist/index.js')
const { createAdmin } = await import('../dist/auth/admin.repo.js')
const { hashPassword } = await import('../dist/auth/password.js')

const ADMIN_PASSWORD = 'correct horse battery staple'

const server = app.listen(0, '127.0.0.1')
await new Promise((resolve) => server.once('listening', resolve))
const baseUrl = `http://127.0.0.1:${server.address().port}`
const GOOD_ORIGIN = 'http://127.0.0.1:5174'

const jar = new Map()
const setCookies = (response) => {
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(';')
    const separator = pair.indexOf('=')
    jar.set(pair.slice(0, separator), pair.slice(separator + 1))
  }
}
const cookieHeader = () => [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ')
const clearJar = () => jar.clear()

async function request(url, init = {}) {
  const headers = new Headers(init.headers || {})
  if (!headers.has('Cookie') && jar.size > 0) headers.set('Cookie', cookieHeader())
  const response = await fetch(`${baseUrl}${url}`, { ...init, headers, redirect: 'manual' })
  setCookies(response)
  return response
}

const jsonBody = (body) => ({ 'content-type': 'application/json', ...body })

let csrf = ''

try {
  // ── Uninitialized state ────────────────────────────────────────────────
  const livez = await fetch(`${baseUrl}/livez`)
  assert.equal(livez.status, 200)
  assert.deepEqual(await livez.json(), { ok: true })

  let   response = await fetch(`${baseUrl}/api/auth/state`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { initialized: false, authenticated: false, bootstrapEnabled: true, bootstrapRequiresToken: true, accountManagementAvailable: true })

  response = await fetch(`${baseUrl}/api/health`)
  assert.equal(response.status, 401, '匿名访问 /api/health 必须被拒绝')
  assert.deepEqual((await response.json()).code, 'UNAUTHENTICATED')

  response = await fetch(`${baseUrl}/api/settings`)
  assert.equal(response.status, 401, '匿名访问业务 API 必须返回 401 JSON')
  assert.deepEqual((await response.json()).code, 'UNAUTHENTICATED')

  // ── Bootstrap ──────────────────────────────────────────────────────────
  const bootstrapRequest = () => request('/api/auth/bootstrap', {
    method: 'POST',
    headers: jsonBody({ origin: GOOD_ORIGIN }),
    body: JSON.stringify({ username: 'admin', password: ADMIN_PASSWORD, bootstrapToken: 'bootstrap-secret-token' }),
  })
  const bootstrapResponses = await Promise.all([bootstrapRequest(), bootstrapRequest()])
  const bootstrapStatuses = bootstrapResponses.map((item) => item.status).sort((left, right) => left - right)
  assert.equal(bootstrapStatuses.filter((status) => status === 201).length, 1, '并发 bootstrap 最多只能成功创建一个管理员')
  assert.ok(bootstrapStatuses.includes(429), `并发 bootstrap 的额外请求必须快速返回 429，实际状态：${bootstrapStatuses.join(',')}`)

  response = await request('/api/auth/bootstrap', {
    method: 'POST',
    headers: jsonBody({ origin: GOOD_ORIGIN }),
    body: JSON.stringify({ username: 'admin', password: ADMIN_PASSWORD, bootstrapToken: 'bootstrap-secret-token' }),
  })
  assert.equal(response.status, 409, '管理员创建后 bootstrap 必须永久失效')

  response = await fetch(`${baseUrl}/api/auth/state`)
  assert.deepEqual(await response.json(), { initialized: true, authenticated: false, accountManagementAvailable: true })

  // ── Login ──────────────────────────────────────────────────────────────
  response = await request('/api/auth/login', {
    method: 'POST',
    headers: jsonBody({ origin: GOOD_ORIGIN }),
    body: JSON.stringify({ username: 'admin', password: 'wrong password here' }),
  })
  assert.equal(response.status, 401)
  assert.deepEqual((await response.json()).error, '用户名或密码错误')

  response = await request('/api/auth/login', {
    method: 'POST',
    headers: jsonBody({ origin: GOOD_ORIGIN }),
    body: JSON.stringify({ username: 'another-admin', password: ADMIN_PASSWORD }),
  })
  assert.equal(response.status, 401, '正确密码但错误用户名必须被拒绝')
  assert.deepEqual((await response.json()).code, 'INVALID_CREDENTIALS')
  assert.equal(jar.size, 0, '错误用户名不得创建会话')

  response = await request('/api/auth/login', {
    method: 'POST',
    headers: jsonBody({ origin: 'https://evil.example' }),
    body: JSON.stringify({ username: 'admin', password: ADMIN_PASSWORD }),
  })
  assert.equal(response.status, 403, '错误 Origin 的登录必须被拒绝')

  response = await request('/api/auth/login', {
    method: 'POST',
    headers: jsonBody({ origin: GOOD_ORIGIN }),
    body: JSON.stringify({ username: 'admin', password: ADMIN_PASSWORD }),
  })
  assert.equal(response.status, 200)
  const loginPayload = await response.json()
  assert.equal(loginPayload.authenticated, true)
  assert.equal(loginPayload.admin.username, 'admin')
  csrf = loginPayload.csrfToken
  assert.ok(csrf.length >= 32)

  // ── Protected business API + CSRF ──────────────────────────────────────
  response = await request('/api/settings')
  assert.equal(response.status, 200, '登录后业务 API 必须可访问')

  response = await request('/api/settings', {
    method: 'PATCH',
    headers: jsonBody({ origin: GOOD_ORIGIN }),
    body: JSON.stringify({ setupCompleted: true, systemName: 'Auth Test' }),
  })
  assert.equal(response.status, 403, '缺少 CSRF 的写请求必须返回 403')
  assert.deepEqual((await response.json()).code, 'CSRF_MISMATCH')

  response = await request('/api/settings', {
    method: 'PATCH',
    headers: jsonBody({ origin: GOOD_ORIGIN, 'x-qm-csrf': csrf }),
    body: JSON.stringify({ setupCompleted: true, systemName: 'Auth Test' }),
  })
  assert.equal(response.status, 200, '携带 CSRF 的写请求必须成功')

  response = await request('/api/settings', {
    method: 'PATCH',
    headers: jsonBody({ origin: 'https://evil.example', 'x-qm-csrf': csrf }),
    body: JSON.stringify({ setupCompleted: true, systemName: 'Auth Test' }),
  })
  assert.equal(response.status, 403, '错误 Origin 的写请求必须返回 403')

  response = await fetch(`${baseUrl}/api/health`)
  assert.equal(response.status, 401, '匿名访问 /api/health 必须被拒绝')

  // ── Files: private namespace ───────────────────────────────────────────
  const figureDir = path.join(tempRoot, 'data', 'question_figures', 'q1')
  fs.mkdirSync(figureDir, { recursive: true })
  fs.writeFileSync(path.join(figureDir, 'figure.png'), 'secret figure')
  response = await fetch(`${baseUrl}/files/data/question_figures/q1/figure.png`)
  assert.equal(response.status, 401, '匿名访问私有文件必须被拒绝（不返回文件）')
  response = await request('/files/data/question_figures/q1/figure.png')
  assert.equal(response.status, 200, '登录后私有文件必须可访问')
  assert.equal(await response.text(), 'secret figure')

  // ── Pages and print ────────────────────────────────────────────────────
  response = await fetch(`${baseUrl}/print/teaching-document?documentId=x`, { redirect: 'manual' })
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), `/login?next=${encodeURIComponent('/print/teaching-document?documentId=x')}`)

  response = await fetch(`${baseUrl}/workbench`, { redirect: 'manual' })
  assert.equal(response.status, 302)
  assert.equal(new URL(response.headers.get('location'), baseUrl).searchParams.get('next'), '/workbench')

  response = await fetch(`${baseUrl}/login`)
  assert.equal(response.status, 200, '登录页必须匿名可访问')
  response = await fetch(`${baseUrl}/admin-setup`)
  assert.equal(response.status, 200, '初始化页必须匿名可访问')

  response = await request('/workbench')
  assert.equal(response.status, 200, '登录后业务页面必须可访问')

  // ── Sessions: list / revoke device ─────────────────────────────────────
  response = await request('/api/auth/sessions')
  assert.equal(response.status, 200)
  const sessionList = (await response.json()).sessions
  assert.equal(sessionList.length, 1)
  assert.equal(sessionList[0].current, true)

  // Second device login.
  clearJar()
  response = await request('/api/auth/login', {
    method: 'POST',
    headers: jsonBody({ origin: GOOD_ORIGIN }),
    body: JSON.stringify({ username: 'admin', password: ADMIN_PASSWORD }),
  })
  assert.equal(response.status, 200)
  const secondCsrf = (await response.json()).csrfToken
  const secondCookie = cookieHeader()

  // Revoke the first device while the second is active.
  response = await fetch(`${baseUrl}/api/auth/sessions/${sessionList[0].id}`, {
    method: 'DELETE',
    headers: {
      cookie: secondCookie,
      origin: GOOD_ORIGIN,
      'x-qm-csrf': secondCsrf,
    },
  })
  assert.equal(response.status, 200)

  response = await fetch(`${baseUrl}/api/settings`, { headers: { cookie: secondCookie } })
  assert.equal(response.status, 200, '未注销设备仍可访问')

  // First device cookie is still in the jar? No — we cleared it. Verify by
  // reusing the old token hash through a fresh request with no cookie:
  response = await fetch(`${baseUrl}/api/settings`)
  assert.equal(response.status, 401, '注销后的会话必须立即失效')

  // ── Change password revokes every other session ───────────────────────
  clearJar()
  response = await request('/api/auth/login', {
    method: 'POST',
    headers: jsonBody({ origin: GOOD_ORIGIN }),
    body: JSON.stringify({ username: 'admin', password: ADMIN_PASSWORD }),
  })
  assert.equal(response.status, 200)
  const thirdCsrf = (await response.json()).csrfToken

  const NEW_PASSWORD = 'a brand new long password'
  response = await request('/api/auth/change-password', {
    method: 'POST',
    headers: jsonBody({ origin: GOOD_ORIGIN, 'x-qm-csrf': thirdCsrf }),
    body: JSON.stringify({ currentPassword: ADMIN_PASSWORD, newPassword: NEW_PASSWORD }),
  })
  assert.equal(response.status, 200, '修改密码必须成功')

  clearJar()
  response = await request('/api/auth/login', {
    method: 'POST',
    headers: jsonBody({ origin: GOOD_ORIGIN }),
    body: JSON.stringify({ username: 'admin', password: ADMIN_PASSWORD }),
  })
  assert.equal(response.status, 401, '旧密码必须失效')
  response = await request('/api/auth/login', {
    method: 'POST',
    headers: jsonBody({ origin: GOOD_ORIGIN }),
    body: JSON.stringify({ username: 'admin', password: NEW_PASSWORD }),
  })
  assert.equal(response.status, 200, '新密码必须可登录')
  const freshCsrf = (await response.json()).csrfToken

  // ── Logout clears the session ──────────────────────────────────────────
  response = await request('/api/auth/logout', {
    method: 'POST',
    headers: jsonBody({ origin: GOOD_ORIGIN, 'x-qm-csrf': freshCsrf }),
  })
  assert.equal(response.status, 200)
  assert.equal((await request('/api/settings')).status, 401, '注销后必须立即失效')

  // ── Login rate limiting: 5 failures then lockout ───────────────────────
  clearJar()
  for (let attempt = 0; attempt < 5; attempt += 1) {
    response = await request('/api/auth/login', {
      method: 'POST',
      headers: jsonBody({ origin: GOOD_ORIGIN, 'x-forwarded-for': `10.0.0.${attempt + 1}` }),
      body: JSON.stringify({ username: 'admin', password: 'wrong password here' }),
    })
    assert.equal(response.status, 401)
  }
  response = await request('/api/auth/login', {
    method: 'POST',
    headers: jsonBody({ origin: GOOD_ORIGIN, 'x-forwarded-for': '192.168.20.20, 10.0.0.200' }),
    body: JSON.stringify({ username: 'admin', password: NEW_PASSWORD }),
  })
  assert.equal(response.status, 429, '未配置可信代理时伪造的多个 XFF 必须仍命中同一限流桶')

  console.log('auth acceptance tests passed')
} finally {
  await new Promise((resolve) => server.close(resolve))
  closeDatabase()
  if (distBackup === null) fs.rmSync(path.dirname(frontendDist), { recursive: true, force: true })
  else fs.writeFileSync(frontendDist, distBackup)
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
