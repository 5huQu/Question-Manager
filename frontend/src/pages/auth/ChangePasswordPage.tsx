import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { changePassword } from '@/auth/authApi'
import { ApiError } from '@/api/client'

const MIN_LENGTH = 8
const MAX_LENGTH = 128

export function ChangePasswordPage() {
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSuccess('')
    if (newPassword.length < MIN_LENGTH || newPassword.length > MAX_LENGTH) {
      setError(`新密码长度需要在 ${MIN_LENGTH} 到 ${MAX_LENGTH} 个字符之间。`)
      return
    }
    if (newPassword !== confirm) {
      setError('两次输入的新密码不一致。')
      return
    }
    setSubmitting(true)
    try {
      await changePassword(currentPassword, newPassword)
      setSuccess('密码已更新，其他登录设备已全部注销。')
      setCurrentPassword('')
      setNewPassword('')
      setConfirm('')
      setTimeout(() => navigate('/settings'), 1200)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.payload.error ? String(err.payload.error) : err.message)
      } else {
        setError(err instanceof Error ? err.message : '修改密码失败，请稍后再试。')
      }
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="mb-5 text-left">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">修改密码</h1>
        <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400">修改后除当前设备外的所有登录会话都会被注销。</p>
      </div>

      {success ? (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
          {success}
        </div>
      ) : null}
      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <label className="block space-y-1.5 text-left">
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">当前密码</span>
          <input
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
            required
            className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-950 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-300"
          />
        </label>
        <label className="block space-y-1.5 text-left">
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">新密码（至少 {MIN_LENGTH} 个字符）</span>
          <input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            required
            className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-950 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-300"
          />
        </label>
        <label className="block space-y-1.5 text-left">
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">再次输入新密码</span>
          <input
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            required
            className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-950 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-300"
          />
        </label>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="h-9 rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="h-9 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {submitting ? '提交中...' : '修改密码'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default ChangePasswordPage
