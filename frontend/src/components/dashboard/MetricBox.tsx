import { Layers, Scissors, Cpu, Database } from 'lucide-react'

type MetricColor = 'zinc' | 'amber' | 'indigo' | 'emerald'

export function MetricBox({
  title,
  value,
  subtitle,
  color = 'zinc',
}: {
  title: string
  value: string | number
  subtitle: string
  color?: MetricColor
}) {
  const bgStyles = {
    zinc: 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-50',
    amber: 'bg-gradient-to-br from-amber-500/5 via-transparent to-transparent bg-white dark:bg-zinc-900 border-amber-200/60 dark:border-amber-900/20 text-zinc-900 dark:text-zinc-50',
    indigo: 'bg-gradient-to-br from-indigo-500/5 via-transparent to-transparent bg-white dark:bg-zinc-900 border-indigo-200/60 dark:border-indigo-900/20 text-zinc-900 dark:text-zinc-50',
    emerald: 'bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent bg-white dark:bg-zinc-900 border-emerald-200/60 dark:border-emerald-900/20 text-zinc-900 dark:text-zinc-50',
  }

  const iconColors = {
    zinc: 'text-zinc-505 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/80',
    amber: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200/10 dark:border-amber-900/10',
    indigo: 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200/10 dark:border-indigo-900/10',
    emerald: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/10 dark:border-emerald-900/10',
  }

  const pulseColors = {
    zinc: 'bg-zinc-450 dark:bg-zinc-500',
    amber: 'bg-amber-500',
    indigo: 'bg-indigo-500',
    emerald: 'bg-emerald-500',
  }

  // Get matching icon
  const Icon = (() => {
    switch (color) {
      case 'amber':
        return Scissors
      case 'indigo':
        return Cpu
      case 'emerald':
        return Database
      default:
        return Layers
    }
  })()

  return (
    <div className={`p-4 rounded-2xl border ${bgStyles[color]} flex flex-col justify-between h-28 shadow-sm hover:shadow-md transition-all duration-300 relative group overflow-hidden`}>
      {/* Light gradient hover flash */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-[1200ms] ease-out"></div>

      <div className="flex justify-between items-start">
        <div className="space-y-1">
          <span className="text-[10px] font-semibold tracking-wider uppercase text-zinc-400 dark:text-zinc-500">{title}</span>
          <h3 className="text-2xl font-bold leading-none tracking-tight">{value}</h3>
        </div>

        {/* Glow Icon Sphere */}
        <div className={`size-8.5 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110 ${iconColors[color]}`}>
          <Icon className="size-4.5" />
        </div>
      </div>

      <div className="flex items-center justify-between mt-auto">
        <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium truncate max-w-[80%]">{subtitle}</p>

        {/* Status Dot */}
        <span className="flex items-center gap-1.5 text-[9px] font-semibold text-zinc-400 dark:text-zinc-500 select-none">
          <span className="relative flex h-1.5 w-1.5">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${pulseColors[color]}`} />
            <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${pulseColors[color]}`} />
          </span>
          <span>运行中</span>
        </span>
      </div>
    </div>
  )
}
