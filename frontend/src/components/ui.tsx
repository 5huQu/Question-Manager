import type { ComponentPropsWithoutRef, MouseEventHandler, ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Check, LoaderCircle, type LucideIcon } from 'lucide-react'
import { clsx } from 'clsx'

export function cn(...inputs: Array<string | false | null | undefined>) {
  return clsx(inputs)
}

type ButtonClickHandler = MouseEventHandler<HTMLButtonElement> | ((arg?: never) => void | Promise<unknown>)

function displayValue(value: unknown): ReactNode {
  if (value == null) return 0
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

export function Tab({ to, icon: Icon, title, desc }: { to: string; icon: LucideIcon; title: string; desc: string }) {
  return <NavLink to={to} className={({ isActive }) => `flex min-h-16 items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors ${isActive ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-transparent bg-card text-card-foreground hover:bg-accent hover:text-accent-foreground'}`}><span className="flex size-8 items-center justify-center rounded-md bg-muted text-foreground"><Icon className="size-4" /></span><span className="min-w-0"><span className="block truncate text-sm font-semibold">{title}</span><span className="block truncate text-xs opacity-70">{desc}</span></span></NavLink>
}

export function WorkspaceCard({ to, icon: Icon, title, desc, metrics }: { to: string; icon: LucideIcon; title: string; desc: string; metrics: Array<[string, string]> }) {
  return <Link className="rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:bg-accent/40" to={to}><div className="flex justify-between gap-3"><div><h2 className="font-semibold">{title}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{desc}</p></div><span className="flex size-8 items-center justify-center rounded-lg bg-muted"><Icon className="size-4" /></span></div><div className="mt-4 grid grid-cols-3 gap-2">{metrics.map(([label, value]) => <div key={label} className="rounded-lg border bg-background px-2.5 py-2"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-0.5 text-sm font-semibold">{displayValue(value)}</p></div>)}</div></Link>
}

export function PageTitle({ title, desc, path }: { title: string; desc: string; path: string }) {
  return <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1><p className="mt-1 text-sm text-muted-foreground">{desc}</p></div><Badge>{path}</Badge></div>
}

export function Panel({ title, children, actions, className = '', bodyClassName = '' }: { title: string; children: ReactNode; actions?: ReactNode; className?: string; bodyClassName?: string }) {
  return <section className={`overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm ${className}`}><div className="flex min-h-12 items-center justify-between gap-3 border-b px-5 py-4"><h3 className="text-sm font-semibold">{title}</h3>{actions}</div><div className={`p-4 ${bodyClassName}`}>{children}</div></section>
}

export function SummaryGrid({ items }: { items: Array<[string, unknown]> }) {
  return <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">{items.map(([labelText, value]) => <div key={labelText} className="rounded-xl border bg-card p-4 text-card-foreground shadow-sm"><p className="text-xs font-medium text-muted-foreground">{labelText}</p><p className="mt-1 text-2xl font-bold">{displayValue(value)}</p></div>)}</div>
}

export function Button({ children, icon: Icon, variant = 'default', size = 'default', className = '', asLink, to = '', disabled, onClick, type = 'button', title }: { children: ReactNode; icon?: LucideIcon; variant?: 'default' | 'outline' | 'danger'; size?: 'default' | 'sm'; className?: string; asLink?: boolean; to?: string; disabled?: boolean; onClick?: ButtonClickHandler; type?: 'button' | 'submit' | 'reset'; title?: string }) {
  const variantClass = variant === 'danger'
    ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground border border-transparent'
    : variant === 'default'
      ? 'bg-primary hover:bg-primary/90 text-primary-foreground border border-transparent shadow-sm'
      : 'border border-input bg-background hover:bg-accent hover:text-accent-foreground text-foreground shadow-sm'
  const classes = `inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap ${size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-3.5 text-sm'} ${variantClass} ${className}`
  const content = <>{Icon ? <Icon className={`size-4 ${Icon === LoaderCircle ? 'animate-spin' : ''}`} /> : null}{children}</>
  const handleClick: MouseEventHandler<HTMLButtonElement> | undefined = onClick
    ? (event) => {
        if (onClick.length === 0) {
          void (onClick as () => void | Promise<unknown>)()
        } else {
          void (onClick as MouseEventHandler<HTMLButtonElement>)(event)
        }
      }
    : undefined
  return asLink ? <Link className={classes} title={title} to={to}>{content}</Link> : <button className={classes} disabled={disabled} onClick={handleClick} title={title} type={type}>{content}</button>
}

export function Badge({ children, variant = 'default', className = '', title }: { children: ReactNode; variant?: 'default' | 'success' | 'warning' | 'danger' | 'outline'; className?: string; title?: string }) {
  const variantClasses = {
    default: 'border-transparent bg-secondary text-secondary-foreground',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    danger: 'border-transparent bg-destructive/10 text-destructive',
    outline: 'border-input bg-background text-foreground',
  }
  return <span className={`inline-flex min-h-5 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${variantClasses[variant]} ${className}`} title={title}>{children}</span>
}

export function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed bg-card/60 px-4 py-8 text-center text-sm text-muted-foreground">{text}</div>
}

export function MiniMetric({ label, value }: { label: string; value: unknown }) {
  return <div className="rounded-lg border bg-muted/40 px-3 py-2"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{displayValue(value)}</p></div>
}

export function SelectFilter({ label: labelText, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <select className="h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none focus:ring-1 focus:ring-ring" value={value} onChange={(event) => onChange(event.target.value)}>
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
      <span className="text-xs text-muted-foreground">{labelText}</span>
      {visibleTags.slice(0, 6).map((tag) => <span key={tag} className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{tag}</span>)}
    </div>
  )
}

export function Info({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3 rounded-lg border bg-card px-3 py-2"><span className="text-xs text-muted-foreground">{label}</span><span className="text-right text-xs font-medium">{value}</span></div>
}

export function StatusLine({ done, label }: { done?: boolean; label: string }) {
  return <div className="flex items-center gap-2 text-xs"><span className={`flex size-4 items-center justify-center rounded-full border ${done ? 'border-primary bg-primary text-primary-foreground' : 'bg-background'}`}>{done ? <Check className="size-3" /> : null}</span><span className={done ? 'text-foreground' : 'text-muted-foreground'}>{label}</span></div>
}

export function Input(props: ComponentPropsWithoutRef<'input'>) {
  return <input {...props} className={cn('flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50', props.className)} />
}
