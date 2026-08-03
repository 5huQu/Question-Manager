import { useCallback, useEffect, useState } from 'react'
import { listSessions, revokeSession } from '@/auth/authApi'
import type { AuthSessionInfo } from '@/auth/authTypes'
import { ApiError } from '@/api/client'

function formatTime(value: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function userAgentLabel(value: string | null) {
  if (!value) return '未知设备'
  if (value.includes('Electron')) return `桌面应用 (${value.replace(/Electron\/[\d.]+/, '').trim() || '本地'})`
  if (value.includes('Windows')) return 'Windows 浏览器'
  if (value.includes('Macintosh') || value.includes('Mac OS')) return 'macOS 浏览器'
  if (value.includes('Linux')) return 'Linux 浏览器'
  if (value.includes('Android')) return 'Android 浏览器'
  if (value.includes('iPhone') || value.includes('iPad')) return 'iOS 浏览器'
  return value.slice(0, 60)
}

export function SessionsPage() {
  const [sessions, setSessions] = useState<AuthSessionInfo[] | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busyId, setBusyId] = useState('')

  const load = useCallback(() => {
    setError('')
    listSessions()
      .then(setSessions)
      .catch((err) => setError(err instanceof ApiError ? String(err.payload.error || err.message) : '加载失败，请稍后再试。'))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleRevoke(session: AuthSessionInfo) {
    setBusyId(session.id)
    setMessage('')
    setError('')
    try {
      await revokeSession(session.id)
      if (session.current) {
        window.location.assign('/login?reason=revoked')
        return
      }
      setMessage('该设备已注销。')
      load()
    } catch (err) {
      setError(err instanceof ApiError ? String(err.payload.error || err.message) : '注销失败，请稍后再试。')
    } finally {
      setBusyId('')
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-5 text-left">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">登录设备</h1>
        <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400">查看当前登录会话，并可以随时注销其他设备。</p>
      </div>

      {message ? (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {sessions === null ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center text-xs text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
          加载会话中...
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-zinc-200 bg-zinc-50/70 px-4 py-2.5 text-[12px] font-semibold text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40">
            <span>设备</span>
            <span>操作</span>
          </div>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {sessions.map((session) => (
              <li key={session.id} className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3">
                <div className="min-w-0 text-left">
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-100">
                    <span className="truncate">{userAgentLabel(session.userAgent)}</span>
                    {session.current ? (
                      <span className="rounded border border-green-200 bg-green-50 px-1.5 py-0.5 text-[10px] font-semibold text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
                        当前设备
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                    {session.loginIp ? `IP ${session.loginIp} · ` : ''}登录于 {formatTime(session.createdAt)} · 最近活跃 {formatTime(session.lastSeenAt)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRevoke(session)}
                  disabled={busyId === session.id}
                  className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-red-800 dark:hover:bg-red-950 dark:hover:text-red-300"
                >
                  {busyId === session.id ? '注销中...' : '注销'}
                </button>
              </li>
            ))}
          </ul>
          {sessions.length === 0 ? (
            <div className="p-6 text-center text-xs text-zinc-400">暂无登录会话。</div>
          ) : null}
        </div>
      )}
    </div>
  )
}

export default SessionsPage
