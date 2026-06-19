import { FileUp } from 'lucide-react'

export function SeparatedFileInput({ title, desc, files, inputId, onChange }: { title: string; desc: string; files: FileList | null; inputId: string; onChange: (files: FileList | null) => void }) {
  return (
    <button
      type="button"
      onClick={() => document.getElementById(inputId)?.click()}
      className="flex min-h-20 w-full items-center gap-3 rounded-xl border border-dashed border-zinc-200 bg-white p-3 text-left transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
    >
      <input
        id={inputId}
        type="file"
        multiple
        accept=".pdf,.doc,.docx,application/pdf"
        className="hidden"
        onChange={(event) => onChange(event.target.files?.length ? event.target.files : null)}
      />
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
        <FileUp className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">{title}</p>
        <p className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">{desc}</p>
        {files?.length ? (
          <p className="mt-1 truncate text-[10px] font-medium text-zinc-600 dark:text-zinc-300">
            已选择 {files.length} 个：{Array.from(files).map((file) => file.name).join('、')}
          </p>
        ) : (
          <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">点击选择文件</p>
        )}
      </div>
    </button>
  )
}
