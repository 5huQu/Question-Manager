#!/usr/bin/env node
/**
 * Single-admin CLI: npm run admin:init | admin:reset-password | admin:revoke-sessions
 *
 * Runs against the built dist, so build the server first (npm run build:server).
 * These commands deliberately bypass the HTTP layer: they are meant to be run
 * on the machine that owns the SQLite database.
 */
import fs from 'node:fs'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath } from 'node:url'

const action = process.argv[2] || 'init'

// Piped stdin (scripts/CI) is read up-front because TTY-style prompt handling
// only applies to real terminals. TTY input stays interactive with hidden
// passwords and full editing (backspace).
const pipedLines = process.stdin.isTTY
  ? null
  : fs.readFileSync(0, 'utf8').split(/\r?\n/)
let pipedIndex = 0

// TTY input is handled by a single global data listener feeding a line queue.
// This survives multi-line paste and pty scripts where several lines arrive
// inside one data event, and it never fights readline for the same stream.
const ttyDecoder = new StringDecoder('utf8')
const lineQueue = []
let currentLine = ''
let pendingPrompt = null
let echoEnabled = false
let inputEnded = false

function pumpLines() {
  while (lineQueue.length > 0 && pendingPrompt) {
    const line = lineQueue.shift()
    const callback = pendingPrompt
    pendingPrompt = null
    process.stdout.write('\n')
    callback(line)
  }
}

function setupTtyInput() {
  const stdin = process.stdin
  stdin.on('data', (chunk) => {
    const text = ttyDecoder.write(chunk)
    for (const char of text) {
      if (char === '\u0003') {
        // Ctrl-C: restore the terminal before exiting.
        process.stdout.write('\n')
        process.exit(130)
      }
      if (char === '\u0004') {
        // EOF marker injected by pty wrappers (e.g. `script`); ignore it.
        continue
      }
      if (char === '\r' || char === '\n') {
        lineQueue.push(currentLine)
        currentLine = ''
        continue
      }
      if (char === '\u007f' || char === '\b') {
        if (currentLine.length > 0) {
          currentLine = currentLine.slice(0, -1)
          if (echoEnabled) process.stdout.write('\b \b')
        }
        continue
      }
      currentLine += char
      if (echoEnabled) process.stdout.write(char)
    }
    pumpLines()
  })
  stdin.on('end', () => {
    // Real EOF (Ctrl-D on an empty line or closed pipe): answer empty so the
    // CLI can validate and exit instead of hanging forever.
    inputEnded = true
    if (pendingPrompt) {
      const callback = pendingPrompt
      pendingPrompt = null
      process.stdout.write('\n')
      callback('')
    }
  })
  try {
    stdin.setRawMode(true)
  } catch {
    // Raw mode unavailable; the line-buffered fallback still works.
  }
  stdin.resume()
}

/**
 * Single prompt implementation. readline is not used because its internal
 * listeners race with raw-mode input and swallow the Enter key.
 */
function ask(question, { hidden = false } = {}) {
  if (pipedLines !== null) {
    process.stdout.write(`${question}\n`)
    return Promise.resolve(pipedLines[pipedIndex++]?.trim() ?? '')
  }
  if (inputEnded) return Promise.resolve('')
  return new Promise((resolve) => {
    echoEnabled = !hidden
    process.stdout.write(question)
    pendingPrompt = (line) => {
      echoEnabled = false
      resolve(line)
    }
    pumpLines()
  })
}

async function ensureBuiltDist() {
  const distIndex = fileURLToPath(new URL('../dist/db/connection.js', import.meta.url))
  if (!fs.existsSync(distIndex)) {
    throw new Error('未找到 server/dist，请先运行 npm run build:server')
  }
}

const PASSWORD_MIN_LENGTH = 12
const PASSWORD_MAX_LENGTH = 128

function validatePassword(password) {
  if (password.length < PASSWORD_MIN_LENGTH) return `密码长度至少 ${PASSWORD_MIN_LENGTH} 个字符`
  if (password.length > PASSWORD_MAX_LENGTH) return `密码长度最多 ${PASSWORD_MAX_LENGTH} 个字符`
  return ''
}

async function main() {
  await ensureBuiltDist()
  const { ensureSchema } = await import('../dist/db/schema.js')
  const { closeDatabase } = await import('../dist/db/connection.js')
  const { hashPassword } = await import('../dist/auth/password.js')
  const { createAdmin, getAdmin, updateAdminPassword, updateAdminUsername } = await import('../dist/auth/admin.repo.js')
  const { revokeAllSessions } = await import('../dist/auth/sessions.repo.js')

  ensureSchema()

  if (process.stdin.isTTY) setupTtyInput()

  try {
    if (action === 'init') {
      if (getAdmin()) {
        console.error('管理员已存在，如需重置请使用：npm run admin:reset-password')
        process.exitCode = 1
        return
      }
      const username = await ask('管理员用户名：')
      if (!username || username.length > 64) {
        console.error('用户名无效。')
        process.exitCode = 1
        return
      }
      const password = await ask('输入密码：', { hidden: true })
      const confirm = await ask('再次输入密码：', { hidden: true })
      const problem = validatePassword(password)
      if (problem) {
        console.error(problem)
        process.exitCode = 1
        return
      }
      if (password !== confirm) {
        console.error('两次输入的密码不一致。')
        process.exitCode = 1
        return
      }
      const stored = await hashPassword(password)
      createAdmin(username, stored)
      console.log('管理员已创建')
      return
    }

    if (action === 'reset-password') {
      const admin = getAdmin()
      if (!admin) {
        console.error('管理员尚未初始化，请先运行：npm run admin:init')
        process.exitCode = 1
        return
      }
      const username = (await ask(`管理员用户名（当前：${admin.username}，回车保持不变）：`)) || admin.username
      const password = await ask('输入新密码：', { hidden: true })
      const confirm = await ask('再次输入新密码：', { hidden: true })
      const problem = validatePassword(password)
      if (problem) {
        console.error(problem)
        process.exitCode = 1
        return
      }
      if (password !== confirm) {
        console.error('两次输入的密码不一致。')
        process.exitCode = 1
        return
      }
      const stored = await hashPassword(password)
      updateAdminPassword(username, stored)
      updateAdminUsername(username)
      const revoked = revokeAllSessions()
      console.log(`密码已更新，已注销 ${revoked} 个登录会话`)
      return
    }

    if (action === 'revoke-sessions') {
      const revoked = revokeAllSessions()
      console.log(`已注销全部 ${revoked} 个登录会话`)
      return
    }

    console.error(`未知命令：${action}（支持 init / reset-password / revoke-sessions）`)
    process.exitCode = 1
  } finally {
    closeDatabase()
  }
}

main().then(() => {
  // Explicit exit: the TTY input listeners keep the event loop alive.
  process.exit(process.exitCode || 0)
}).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
