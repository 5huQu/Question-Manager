import { FileUp } from 'lucide-react'

export function SeparatedFileInput({ title, desc, files, inputId, onChange }: { title: string; desc: string; files: FileList | null; inputId: string; onChange: (files: FileList | null) => void }) {
  return (
    <button
      type="button"
      onClick={() => document.getElementById(inputId)?.click()}
      className="flex min-h-20 w-full items-center gap-3 rounded-lg border border-dashed border-input bg-background p-3 text-left transition-colors hover:bg-accent/50"
    >
      <input
        id={inputId}
        type="file"
        multiple
        accept=".pdf,.doc,.docx,application/pdf"
        className="hidden"
        onChange={(event) => onChange(event.target.files?.length ? event.target.files : null)}
      />
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <FileUp className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{desc}</p>
        {files?.length ? (
          <p className="mt-1 truncate text-[10px] font-medium text-foreground">
            已选择 {files.length} 个：{Array.from(files).map((file) => file.name).join('、')}
          </p>
        ) : (
          <p className="mt-1 text-[10px] text-muted-foreground">点击选择文件</p>
        )}
      </div>
    </button>
  )
}
