import {
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  Save,
  Trash2,
} from 'lucide-react'

export function SettingsCard({ title, desc, children, footer }: { title: string; desc: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="border-b border-zinc-100 bg-zinc-50/50 p-5 dark:border-zinc-800 dark:bg-zinc-900/10">
        <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{title}</h3>
        <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400">{desc}</p>
      </div>
      <div className="space-y-5 p-5">{children}</div>
      {footer ? <div className="flex justify-end border-t border-zinc-100 bg-zinc-50/50 px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900/10">{footer}</div> : null}
    </div>
  )
}

export function SectionTitle({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`block border-b border-zinc-100 pb-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400 dark:border-zinc-900 ${className}`}>{children}</span>
}

export function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block space-y-1.5 ${className}`}>
      <span className="block text-[13px] font-medium text-zinc-500">{label}</span>
      {children}
    </label>
  )
}

export function TextInput({ value, onChange, placeholder, type = 'text', mono = false }: { value: string; onChange: (value: string) => void; placeholder?: string; type?: string; mono?: boolean }) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={`w-full rounded border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-950 dark:border-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-300 ${mono ? 'font-mono' : ''}`}
    />
  )
}

export function TextArea({ value, onChange, placeholder, rows = 3, mono = false }: { value: string; onChange: (value: string) => void; placeholder?: string; rows?: number; mono?: boolean }) {
  return (
    <textarea
      rows={rows}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={`w-full rounded border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-950 dark:border-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-300 ${mono ? 'font-mono' : ''}`}
    />
  )
}

export function SegmentButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded border px-3 py-1.5 text-xs font-semibold transition-all ${
        active
          ? 'border-zinc-900 bg-zinc-950 text-white shadow-sm dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950'
          : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900'
      }`}
    >
      {children}
    </button>
  )
}

export function SaveButton({ label, loading, onClick }: { label: string; loading: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded bg-zinc-950 px-3 py-1.5 text-xs font-semibold text-zinc-50 transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
    >
      {loading ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
      {label}
    </button>
  )
}

export function StatusLine({ label, status, ready }: { label: string; status: string; ready: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-100 pb-2 text-[13px] dark:border-zinc-900">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <SmallStatus ready={ready}>{status}</SmallStatus>
    </div>
  )
}

export function SmallStatus({ ready, children }: { ready: boolean; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${ready ? 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300' : 'border-red-250 bg-red-50 text-red-750 dark:border-red-900/50 dark:bg-red-955/20 dark:text-red-400'}`}>
      {children}
    </span>
  )
}

export function StatusBanner({ status }: { status: { type: 'success' | 'error'; message: string } }) {
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${status.type === 'success' ? 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300' : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300'}`}>
      {status.message}
    </div>
  )
}

export function ParserRuleRow({
  value,
  index,
  mono,
  placeholder,
  onChange,
  onDelete,
}: {
  value: string
  index: number
  mono?: boolean
  placeholder: string
  onChange: (value: string) => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center px-4 py-2 hover:bg-zinc-50/40 dark:hover:bg-zinc-900/10">
      <span className="w-10 shrink-0 text-center font-mono text-[11px] text-zinc-400">{index + 1}</span>
      <div className="flex-1 px-3">
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className={`w-full rounded border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-900 outline-none focus:border-zinc-950 dark:border-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-300 ${mono ? 'font-mono' : ''}`}
        />
      </div>
      <div className="flex w-10 shrink-0 justify-center">
        <button type="button" onClick={onDelete} className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20">
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

export function Toast({ status }: { status: { type: 'success' | 'error'; message: string } }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-md border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-xs text-zinc-50 shadow-lg animate-fade-in dark:border-zinc-200 dark:bg-zinc-50 dark:text-zinc-950">
      {status.type === 'success' ? <CheckCircle2 className="size-4.5 shrink-0 text-zinc-400" /> : <AlertCircle className="size-4.5 shrink-0 text-red-500" />}
      <div className="space-y-0.5 text-left">
        <span className="block font-bold">{status.type === 'success' ? '配置保存成功' : '配置保存失败'}</span>
        <span className="block text-[10px] text-zinc-400 dark:text-zinc-500">{status.message}</span>
      </div>
    </div>
  )
}
