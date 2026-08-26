import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Copy, FileStack, PanelsTopLeft } from 'lucide-react'
import { A4PaginationPreview } from '@/components/teaching-document/A4PaginationPreview'
import { TeachingDocumentRenderer } from '@/components/teaching-document/TeachingDocumentRenderer'
import type { TeachingSkinTarget, TeachingSkinVariantId } from '@/utils/teachingDocument/skins'
import { teachingSkinVariantSwatchColor } from '@/extensions/teaching-document/skins/shared/palette'
import { skinLabCompatibility, skinLabDefinitionGroups, skinLabDefinitions, skinLabDesignState, skinLabDocument, skinLabVariants } from './teachingSkinLabModel'
import '@/components/teaching-document/teaching-document.css'

type TargetFilter = 'all' | TeachingSkinTarget

export default function TeachingSkinLabPage() {
  const [target, setTarget] = useState<TargetFilter>('all')
  const definitions = useMemo(() => skinLabDefinitions(target === 'all' ? undefined : target), [target])
  const groups = useMemo(() => skinLabDefinitionGroups(target === 'all' ? undefined : target), [target])
  const [selectedId, setSelectedId] = useState(() => definitions[0]?.id || '')
  const [selectedVariantId, setSelectedVariantId] = useState<TeachingSkinVariantId | null>(null)
  const selected = definitions.find((definition) => definition.id === selectedId) || definitions[0]

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id)
  }, [selected, selectedId])

  useEffect(() => {
    setSelectedVariantId(null)
  }, [selected?.id])

  if (!selected) {
    return <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/20 p-8 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">未发现可供预览的 Teaching Skin。</div>
  }

  const document = skinLabDocument(selected)
  const compatibility = skinLabCompatibility(selected)
  const variants = skinLabVariants(selected)
  const designState = skinLabDesignState(selected, selectedVariantId ?? undefined)
  const skinDesignVariantIds = { [selected.id]: selectedVariantId }
  const copySkinId = () => void navigator.clipboard?.writeText(selected.id)

  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-4">
      <header className="sticky top-0 z-10 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Developer tool · Read only</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Teaching Skin Lab</h1>
            <p className="mt-1 text-sm text-zinc-500">直接读取自动发现的 Skin Registry；不保存文档、不调用后端 API。</p>
          </div>
          <div className="flex rounded-lg border border-zinc-200 bg-zinc-100/80 p-0.5 text-xs dark:border-zinc-800 dark:bg-zinc-900/80" aria-label="Skin target filter">
            {([['all', '全部'], ['heading', '标题'], ['box', '信息框']] as const).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setTarget(value)} className={`rounded-md px-3 py-1.5 font-medium ${target === value ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'}`}>{label}</button>
            ))}
          </div>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        {/* 固定在头部卡片下方：外层滚动容器为 app-scroll-container，顶栏偏移 ≈ 头部卡片高度 + 间距 + 页面内边距 */}
        <aside className="xl:sticky xl:top-[8.5rem] xl:flex xl:max-h-[calc(100vh-10rem)] xl:flex-col xl:overflow-y-auto rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <p className="px-2 pb-2 text-xs font-medium text-zinc-500">自动发现的 Skin（{definitions.length}）</p>
          <div className="flex flex-col gap-3">
            {groups.map((group) => (
              <div key={group.label}>
                <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-zinc-400">{group.label}</p>
                <div className="space-y-1">
                  {group.definitions.map((definition) => (
                    <button key={definition.id} type="button" onClick={() => setSelectedId(definition.id)} data-skin-id={definition.id} className={`w-full rounded-lg border px-3 py-2 text-left ${definition.id === selected.id ? 'border-zinc-900 bg-zinc-50/70 dark:border-zinc-100 dark:bg-zinc-900/50' : 'border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-900/50'}`}>
                      <span className="block text-sm font-medium text-zinc-800 dark:text-zinc-100">{definition.label}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{definition.id}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="min-w-0 space-y-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2"><PanelsTopLeft className="size-4 text-zinc-500" /><h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{selected.label}</h2></div>
                <p className="mt-1 font-mono text-xs text-zinc-500">{selected.id}</p>
              </div>
              <button type="button" onClick={copySkinId} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"><Copy className="size-3.5" />复制 ID</button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Meta label="Target" value={selected.target} />
              <Meta label="Version" value={`v${selected.version}`} />
              <Meta label="Design status" value={designState.status} />
            </div>
            <div className="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-900">
              <p className="text-xs font-medium text-zinc-500">Preview variant（仅此实验室会话，不写入文档）</p>
              <div className="mt-2 flex flex-wrap gap-2" aria-label="Skin design variant">
                <button type="button" onClick={() => setSelectedVariantId(null)} className={`rounded-md border px-2.5 py-1 text-xs font-medium ${selectedVariantId === null ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900'}`}>Base</button>
                {variants.map((variant) => {
                  const swatch = teachingSkinVariantSwatchColor(selected, variant.id)
                  return (
                    <button key={variant.id} type="button" onClick={() => setSelectedVariantId(variant.id)} className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${selectedVariantId === variant.id ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900'}`}>
                      {swatch ? <span aria-hidden className="size-2.5 rounded-full border border-black/10" style={{ backgroundColor: swatch }} /> : null}
                      {variant.label}
                    </button>
                  )
                })}
                {!variants.length ? <span className="py-1 text-xs text-zinc-400">此 Skin 尚未声明 Design Variant。</span> : null}
              </div>
            </div>
            <div className="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-900">
              <p className="text-xs font-medium text-zinc-500">Compatibility</p>
              <div className="mt-2 flex flex-wrap gap-2" aria-label="Skin compatibility">
                {compatibility.map((entry) => <span key={entry.label} data-compatibility={entry.status} className={`rounded-md border px-2 py-1 text-[11px] font-medium ${entry.status === 'resolved' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400' : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-400'}`}>{entry.label} · {entry.status === 'resolved' ? 'supported' : 'incompatible'}</span>)}
              </div>
            </div>
            {designState.issues.length ? (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300" data-skin-design-issues="true">
                {designState.issues.map((issue) => `${issue.code}${issue.slotId ? ` · ${issue.slotId}` : ''}`).join('；')}
              </div>
            ) : null}
          </div>

          <PreviewCard title="Screen / continuous preview" icon={<FileStack className="size-4" />}>
            <TeachingDocumentRenderer document={document} skinDesignVariantIds={skinDesignVariantIds} />
          </PreviewCard>
          <PreviewCard title="A4 / print preview" icon={<PanelsTopLeft className="size-4" />}>
            <A4PaginationPreview document={document} zoom={0.58} skinDesignVariantIds={skinDesignVariantIds} />
          </PreviewCard>
        </section>
      </div>
    </main>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/30"><p className="text-[11px] text-zinc-500">{label}</p><p className="mt-0.5 text-sm font-medium text-zinc-800 dark:text-zinc-100">{value}</p></div>
}

function PreviewCard({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950"><header className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50/50 px-5 py-3 text-sm font-medium text-zinc-700 dark:border-zinc-900 dark:bg-zinc-900/20 dark:text-zinc-200">{icon}{title}</header><div className="overflow-auto bg-zinc-50/40 p-5 dark:bg-zinc-950/50">{children}</div></section>
}
