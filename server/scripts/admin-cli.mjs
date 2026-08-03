#!/usr/bin/env node
/**
 * Single-admin CLI: npm run admin:init | admin:reset-password | admin:revoke-sessions
 *
 * Runs against the built dist, so build the server first (npm run build:server).
 * These commands deliberately bypass the HTTP layer: they are meant to be run
 * on the machine that owns the SQLite database.
 */
import fs from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

const action = process.argv[2] || 'init'

// Piped stdin (scripts/CI) is read up-front because readline only answers one
// piped question reliably. TTY input stays interactive with hidden passwords.
const pipedLines = process.stdin.isTTY
  ? null
  : fs.readFileSync(0, 'utf8').split(/\r?\n/)
let pipedIndex = 0

async function ensureBuiltDist() {
  const distIndex = fileURLToPath(new URL('../dist/db/connection.js', import.meta.url))
  if (!fs.existsSync(distIndex)) {
    throw new Error('未找到 server/dist，请先运行 npm run build:server')
  }
}

async function prompt(rl, question, hidden = false) {
  if (pipedLines !== null) {
    process.stdout.write(`${question}\n`)
    return pipedLines[pipedIndex++]?.trim() ?? ''
  }
  if (!hidden) return rl.question(question)
  return new Promise((resolve) => {
    process.stdout.write(question)
    let value = ''
    const stdin = process.stdin
    const onData = (char) => {
      if (char === '\u0004') {
        cleanup()
        resolve('')
        return
      }
      if (char === '\r' || char === '\n') {
        process.stdout.write('\n')
        cleanup()
        resolve(value)
        return
      }
      if (char === '\u007f' || char === '\b') {
        value = value.slice(0, -1)
        return
      }
      value += char
    }
    const cleanup = () => stdin.off('data', onData)
    stdin.resume()
    stdin.setRawMode(true)
    stdin.on('data', onData)
  })
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

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    if (action === 'init') {
      if (getAdmin()) {
        console.error('管理员已存在，如需重置请使用：npm run admin:reset-password')
        process.exitCode = 1
        return
      }
      const username = await prompt(rl, '管理员用户名：')
      if (!username || username.length > 64) {
        console.error('用户名无效。')
        process.exitCode = 1
        return
      }
      const password = await prompt(rl, '输入密码：', true)
      const confirm = await prompt(rl, '再次输入密码：', true)
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
      const username = (await prompt(rl, `管理员用户名（当前：${admin.username}，回车保持不变）：`)) || admin.username
      const password = await prompt(rl, '输入新密码：', true)
      const confirm = await prompt(rl, '再次输入新密码：', true)
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
    rl.close()
    closeDatabase()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
