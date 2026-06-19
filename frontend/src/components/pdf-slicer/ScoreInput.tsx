export function ScoreInput({ label, suffix, value, onChange }: { label: string; suffix: string; value: number; onChange: (value: string) => void }) {
  return (
    <label className="block rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2">
      <span className="block text-[11px] font-semibold text-zinc-600">{label}</span>
      <span className="mt-1 flex items-center gap-1">
        {suffix ? <span className="text-[10px] text-zinc-400">{suffix}</span> : null}
        <input
          className="h-8 min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 text-sm outline-none focus:border-zinc-400"
          type="number"
          min="0"
          step="0.5"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="text-[10px] text-zinc-400">分</span>
      </span>
    </label>
  )
}
