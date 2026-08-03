import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { ApiError } from '@/api/client'
import { getAuthState } from '@/auth/authApi'

export function AdminSetupPage() {
  const { bootstrap } = useAuth()
  const [requiresToken, setRequiresToken] = useState<boolean | null>(null)
  const [bootstrapToken, setBootstrapToken] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let active = true
    void getAuthState().then((status) => {
      if (active) setRequiresToken(status.bootstrapRequiresToken === true)
    }).catch(() => {
      if (active) setRequiresToken(false)
    })
    return () => {
      active = false
    }
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (password !== confirm) {
      setError('两次输入的密码不一致。')
      return
    }
    setSubmitting(true)
    try {
      await bootstrap(username.trim(), password, bootstrapToken.trim())
      window.location.assign('/login?reason=created')
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.payload.error ? String(err.payload.error) : err.message)
      } else {
        setError(err instanceof Error ? err.message : '初始化失败，请稍后再试。')
      }
      setSubmitting(false)
    }
  }

  if (requiresToken === null) {
    return <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950" />
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-6 text-left">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">初始化管理员账号</h1>
          <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400">
            系统尚未初始化，请设置第一个管理员账号。此向导仅首次访问时出现。
          </p>
        </div>

        {error ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          {requiresToken ? (
            <label className="block space-y-1.5 text-left">
              <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">初始化令牌</span>
              <input
                type="password"
                value={bootstrapToken}
                onChange={(event) => setBootstrapToken(event.target.value)}
                autoComplete="off"
                required
                autoFocus
                className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-950 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-300"
              />
            </label>
          ) : null}
          <label className="block space-y-1.5 text-left">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">管理员用户名</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
              autoFocus={!requiresToken}
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-950 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-300"
            />
          </label>
          <label className="block space-y-1.5 text-left">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">密码（至少 8 个字符）</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-950 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-300"
            />
          </label>
          <label className="block space-y-1.5 text-left">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">再次输入密码</span>
            <input
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
              required
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-950 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-300"
            />
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="h-9 w-full rounded-md bg-zinc-950 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {submitting ? '创建中...' : '创建管理员并登录'}
          </button>
          <p className="text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
            创建后该入口永久失效；公开部署可配置 ADMIN_BOOTSTRAP_TOKEN 防止他人抢先初始化。
          </p>
        </form>
      </div>
    </div>
  )
}
