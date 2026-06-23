import { FileUp } from 'lucide-react'

export function SeparatedFileInput({ title, desc, files, inputId, onChange }: { title: string; desc: string; files: FileList | null; inputId: string; onChange: (files: FileList | null) => void }) {
  const hasFiles = Boolean(files?.length)
  return (
    <button
      type="button"
      onClick={() => document.getElementById(inputId)?.click()}
      className={`flex min-h-[4.5rem] w-full items-center gap-3 rounded-lg border border-dashed p-3 text-left transition-colors cursor-pointer ${
        hasFiles
          ? 'border-zinc-900 bg-zinc-50/30 dark:border-zinc-100 dark:bg-zinc-900/30'
          : 'border-zinc-200 bg-white hover:bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/50'
      }`}
    >
      <input
        id={inputId}
        type="file"
        multiple
        accept=".pdf,.doc,.docx,application/pdf"
        className="hidden"
        onChange={(event) => onChange(event.target.files?.length ? event.target.files : null)}
      />
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400">
        <FileUp className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">{title}</p>
        <p className="mt-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">{desc}</p>
        {hasFiles ? (
          <p className="mt-1 truncate text-[10px] font-medium text-zinc-900 dark:text-zinc-50">
            已选择 {files!.length} 个：{Array.from(files!).map((file) => file.name).join('、')}
          </p>
        ) : (
          <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">点击选择文件</p>
        )}
      </div>
    </button>
  )
}
