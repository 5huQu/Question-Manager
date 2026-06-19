import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Check, LoaderCircle, type LucideIcon } from 'lucide-react'

export function Tab({ to, icon: Icon, title, desc }: { to: string; icon: LucideIcon; title: string; desc: string }) {
  return <NavLink to={to} className={({ isActive }) => `flex min-h-16 items-center gap-3 rounded-xl border px-3 py-2.5 ${isActive ? 'border-zinc-950 bg-zinc-950 text-white' : 'border-transparent bg-white hover:bg-zinc-50'}`}><span className="flex size-8 items-center justify-center rounded-lg bg-zinc-100 text-zinc-950"><Icon className="size-4" /></span><span className="min-w-0"><span className="block truncate text-sm font-semibold">{title}</span><span className="block truncate text-xs opacity-70">{desc}</span></span></NavLink>
}

export function WorkspaceCard({ to, icon: Icon, title, desc, metrics }: { to: string; icon: LucideIcon; title: string; desc: string; metrics: Array<[string, string]> }) {
  return <Link className="rounded-2xl border bg-white p-4 shadow-sm hover:border-zinc-400" to={to}><div className="flex justify-between gap-3"><div><h2 className="font-semibold">{title}</h2><p className="mt-1 text-xs leading-5 text-zinc-500">{desc}</p></div><span className="flex size-8 items-center justify-center rounded-lg bg-zinc-100"><Icon className="size-4" /></span></div><div className="mt-4 grid grid-cols-3 gap-2">{metrics.map(([label, value]) => <div key={label} className="rounded-lg border px-2.5 py-2"><p className="text-xs text-zinc-500">{label}</p><p className="mt-0.5 text-sm font-semibold">{value}</p></div>)}</div></Link>
}

export function PageTitle({ title, desc, path }: { title: string; desc: string; path: string }) {
  return <div className="flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-xl font-semibold">{title}</h2><p className="mt-1 text-sm text-zinc-500">{desc}</p></div><Badge>{path}</Badge></div>
}

export function Panel({ title, children, actions, className = '', bodyClassName = '' }: { title: string; children: ReactNode; actions?: ReactNode; className?: string; bodyClassName?: string }) {
  return <section className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${className}`}><div className="flex min-h-12 items-center justify-between gap-3 border-b px-4 py-3"><h3 className="font-semibold">{title}</h3>{actions}</div><div className={`p-4 ${bodyClassName}`}>{children}</div></section>
}

export function SummaryGrid({ items }: { items: Array<[string, unknown]> }) {
  return <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">{items.map(([labelText, value]) => <div key={labelText} className="rounded-2xl border bg-white p-4 shadow-sm"><p className="text-xs text-zinc-500">{labelText}</p><p className="mt-1 text-xl font-semibold">{value ?? 0}</p></div>)}</div>
}

export function Button({ children, icon: Icon, variant = 'default', size = 'default', className = '', asLink, to = '', disabled, onClick, type = 'button', title }: { children: ReactNode; icon?: LucideIcon; variant?: 'default' | 'outline' | 'danger'; size?: 'default' | 'sm'; className?: string; asLink?: boolean; to?: string; disabled?: boolean; onClick?: any; type?: 'button' | 'submit' | 'reset'; title?: string }) {
  const variantClass = variant === 'danger'
    ? 'bg-red-600 hover:bg-red-700 text-white dark:bg-red-950 dark:hover:bg-red-900 dark:text-red-200 border border-transparent'
    : variant === 'default'
      ? 'bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-200 dark:hover:bg-zinc-300 dark:text-zinc-950 border border-transparent'
      : 'border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-900 dark:border-zinc-850 dark:text-zinc-200'
  const classes = `inline-flex items-center justify-center gap-2 rounded-md font-medium transition-all duration-150 active:scale-[0.98] disabled:opacity-50 ${size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-3.5 text-[13px]'} ${variantClass} ${className}`
  const content = <>{Icon ? <Icon className={`size-4 ${Icon === LoaderCircle ? 'animate-spin' : ''}`} /> : null}{children}</>
  return asLink ? <Link className={classes} title={title} to={to}>{content}</Link> : <button className={classes} disabled={disabled} onClick={onClick} title={title} type={type}>{content}</button>
}

export function Badge({ children, variant = 'default' }: { children: ReactNode; variant?: 'default' | 'success' | 'warning' | 'danger' }) {
  const variantClasses = {
    default: 'border-zinc-200 bg-zinc-100 text-zinc-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    danger: 'border-red-200 bg-red-50 text-red-700',
  }
  return <span className={`inline-flex min-h-6 items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold ${variantClasses[variant]}`}>{children}</span>
}

export function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-zinc-500">{text}</div>
}

export function MiniMetric({ label, value }: { label: string; value: unknown }) {
  return <div className="rounded-xl border bg-zinc-50 px-3 py-2"><p className="text-xs text-zinc-500">{label}</p><p className="mt-1 font-semibold">{value}</p></div>
}

export function SelectFilter({ label: labelText, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <select className="h-9 min-w-0 rounded-md border bg-white px-3 text-sm" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{labelText}</option>
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  )
}

export function TagRow({ label: labelText, tags }: { label: string; tags: string[] }) {
  const visibleTags = tags.filter((tag) => tag && tag !== 'OCRT')
  if (!visibleTags.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-zinc-500">{labelText}</span>
      {visibleTags.slice(0, 6).map((tag) => <span key={tag} className="rounded-md border bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-700">{tag}</span>)}
    </div>
  )
}

export function Info({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3 rounded-lg border bg-white px-3 py-2"><span className="text-xs text-zinc-500">{label}</span><span className="text-right text-xs font-medium">{value}</span></div>
}

export function StatusLine({ done, label }: { done?: boolean; label: string }) {
  return <div className="flex items-center gap-2 text-xs"><span className={`flex size-4 items-center justify-center rounded-full border ${done ? 'border-zinc-950 bg-zinc-950 text-white' : 'bg-white'}`}>{done ? <Check className="size-3" /> : null}</span><span className={done ? 'text-zinc-950' : 'text-zinc-500'}>{label}</span></div>
}
