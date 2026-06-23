import { Database, Layers, Scissors } from 'lucide-react'

type MetricColor = 'zinc' | 'amber' | 'emerald'

export function MetricBox({
  title,
  value,
  subtitle,
  color = 'zinc',
  loading = false,
}: {
  title: string
  value: string | number
  subtitle: string
  color?: MetricColor
  loading?: boolean
}) {
  const iconColors = {
    zinc: 'text-foreground bg-muted border border-border/40',
    amber: 'text-amber-700 bg-amber-50 border border-amber-200 dark:text-amber-300 dark:bg-amber-950/30 dark:border-amber-900/50',
    emerald: 'text-emerald-700 bg-emerald-50 border border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-900/50',
  }

  const Icon = (() => {
    switch (color) {
      case 'amber':
        return Scissors
      case 'emerald':
        return Database
      default:
        return Layers
    }
  })()

  return (
    <div className="flex h-28 flex-col justify-between rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex justify-between items-start">
        <div className="space-y-1">
          <span className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">{title}</span>
          {loading ? (
            <span className="block h-7 w-16 animate-pulse rounded-md bg-muted" />
          ) : (
            <h3 className="text-2xl font-bold leading-none tracking-tight">{value}</h3>
          )}
        </div>

        <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${iconColors[color]}`}>
          <Icon className="size-4" />
        </div>
      </div>

      <p className="mt-auto truncate text-[10px] font-medium text-muted-foreground">{subtitle}</p>
    </div>
  )
}
