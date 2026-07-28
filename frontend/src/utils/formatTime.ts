/**
 * 时间格式化工具
 * 提供面向用户的相对时间表达
 */

/** 将 ISO 时间字符串格式化为相对时间（刚刚/N 分钟前/N 小时前/N 天前/日期） */
export function formatRelativeTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const now = Date.now()
  const diffMs = now - date.getTime()
  if (diffMs < 0) return formatAbsoluteDate(date)

  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`

  return formatAbsoluteDate(date)
}

/** 格式化为绝对日期（YYYY/MM/DD 或 YYYY/MM/DD HH:mm） */
export function formatAbsoluteDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const currentYear = new Date().getFullYear()
  if (y === currentYear) return `${m}/${d}`
  return `${y}/${m}/${d}`
}
