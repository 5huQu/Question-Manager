export function MetricBox({ title, value, subtitle, color = 'zinc' }: { title: string; value: string | number; subtitle: string; color?: 'zinc' | 'amber' | 'indigo' | 'emerald' }) {
  const bgStyles = {
    zinc: 'bg-zinc-50 border-zinc-200 text-zinc-900',
    amber: 'bg-amber-50/70 border-amber-200 text-amber-900',
    indigo: 'bg-indigo-50/70 border-indigo-200 text-indigo-900',
    emerald: 'bg-emerald-50/70 border-emerald-200 text-emerald-900',
  }
  const badgeColors = {
    zinc: 'bg-zinc-200 text-zinc-700',
    amber: 'bg-amber-200/80 text-amber-800',
    indigo: 'bg-indigo-200/80 text-indigo-800',
    emerald: 'bg-emerald-200/80 text-emerald-800',
  }
  return (
    <div className={`p-4 rounded-2xl border ${bgStyles[color]} flex flex-col justify-between h-28 shadow-sm`}>
      <div className="flex justify-between items-center">
        <span className="text-[10px] font-bold tracking-wider uppercase text-zinc-500">{title}</span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${badgeColors[color]}`}>在线</span>
      </div>
      <div>
        <h3 className="text-2xl font-bold leading-none">{value}</h3>
        <p className="text-[10px] text-zinc-400 mt-1 font-medium">{subtitle}</p>
      </div>
    </div>
  )
}
