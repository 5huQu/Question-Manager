import { useState } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { SettingsCard } from './components'

function AccountLogoutButton() {
  const { logout, admin } = useAuth()
  const [loggingOut, setLoggingOut] = useState(false)
  return (
    <button
      type="button"
      disabled={loggingOut}
      onClick={() => {
        setLoggingOut(true)
        void logout().finally(() => {
          window.location.assign('/login')
        })
      }}
      className="inline-flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-xs font-semibold text-zinc-700 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-red-800 dark:hover:bg-red-950 dark:hover:text-red-300"
    >
      <span>{loggingOut ? '退出中...' : `退出登录（${admin?.username || '管理员'}）`}</span>
      <span className="text-zinc-400">→</span>
    </button>
  )
}

export function AccountManagementCard() {
  const { accountManagementAvailable } = useAuth()
  if (!accountManagementAvailable) return null
  return (
    <SettingsCard title="账号与安全" desc="管理管理员密码与登录设备。">
      <div className="flex flex-col gap-2">
        <a
          href="/settings/change-password"
          className="inline-flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <span>修改密码</span>
          <span className="text-zinc-400">→</span>
        </a>
        <a
          href="/settings/sessions"
          className="inline-flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <span>登录设备管理</span>
          <span className="text-zinc-400">→</span>
        </a>
        <AccountLogoutButton />
      </div>
    </SettingsCard>
  )
}
