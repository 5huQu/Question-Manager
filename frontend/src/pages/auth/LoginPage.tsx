import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '@/auth/AuthProvider'
import { ApiError } from '@/api/client'

function safeNextPath(value: string) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/login')) return ''
  return value
}

export function LoginPage() {
  const { login } = useAuth()
  const [searchParams] = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const reason = searchParams.get('reason')
  const next = safeNextPath(searchParams.get('next') || '')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await login(username.trim(), password)
      window.location.assign(next || '/')
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.payload.error ? String(err.payload.error) : err.message)
      } else {
        setError(err instanceof Error ? err.message : '登录失败，请稍后再试。')
      }
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-6 text-left">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Question Manager</h1>
          <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400">登录管理员账号以继续</p>
        </div>

        {reason === 'expired' ? (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            登录已过期，请重新登录。
          </div>
        ) : null}

        {error ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block space-y-1.5 text-left">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">用户名</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
              autoFocus
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-950 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-300"
            />
          </label>
          <label className="block space-y-1.5 text-left">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-950 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-300"
            />
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="h-9 w-full rounded-md bg-zinc-950 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {submitting ? '登录中...' : '登录'}
          </button>
        </form>
      </div>
    </div>
  )
}
