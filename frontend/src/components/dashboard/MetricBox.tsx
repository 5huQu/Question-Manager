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
    zinc: 'bg-card border-border text-card-foreground',
    amber: 'bg-card border-border text-card-foreground',
    indigo: 'bg-card border-border text-card-foreground',
    emerald: 'bg-card border-border text-card-foreground',
  }

  const iconColors = {
    zinc: 'text-foreground bg-muted border border-border/40',
    amber: 'text-foreground bg-muted border border-border/40',
    indigo: 'text-foreground bg-muted border border-border/40',
    emerald: 'text-foreground bg-muted border border-border/40',
  }

  const pulseColors = {
    zinc: 'bg-zinc-400 dark:bg-zinc-500',
    amber: 'bg-zinc-400 dark:bg-zinc-500',
    indigo: 'bg-zinc-400 dark:bg-zinc-500',
    emerald: 'bg-zinc-400 dark:bg-zinc-500',
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
    <div className={`p-4 rounded-xl border ${bgStyles[color]} flex flex-col justify-between h-28 shadow-sm hover:shadow-md transition-all duration-300 relative group overflow-hidden`}>
      {/* Light gradient hover flash */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-[1200ms] ease-out"></div>

      <div className="flex justify-between items-start">
        <div className="space-y-1">
          <span className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">{title}</span>
          <h3 className="text-2xl font-bold leading-none tracking-tight">{value}</h3>
        </div>

        {/* Glow Icon Sphere */}
        <div className={`size-8.5 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110 ${iconColors[color]}`}>
          <Icon className="size-4.5" />
        </div>
      </div>

      <div className="flex items-center justify-between mt-auto">
        <p className="text-[10px] text-muted-foreground font-medium truncate max-w-[80%]">{subtitle}</p>

        {/* Status Dot */}
        <span className="flex items-center gap-1.5 text-[9px] font-semibold text-muted-foreground select-none">
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
