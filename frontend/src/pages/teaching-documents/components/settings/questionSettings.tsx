import { useState } from 'react'
import { ArrowDown, ArrowUp, Database, ImagePlus, Pencil, Trash2 } from 'lucide-react'
import type { QuestionItem } from '@/types'
import type { TeachingBlock } from '@/types/teachingDocument'
import { figureDisplayLabels } from '@/utils/questionDisplay'
import { Field, fieldClass } from './common'

export function QuestionSettings(props: {
  onUpdate: (patch: Partial<TeachingBlock>, mergeKey?: string) => void
  onEditQuestion?: (blockId: string) => void
  onOpenQuestionPicker?: (blockId: string, boxId?: string) => void
  boxId?: string
  onUpload: (file: File) => Promise<{ id: string }>
  block: Extract<TeachingBlock, { type: 'question' }>
  question?: QuestionItem
}) {
  const [uploading, setUploading] = useState(false)
  const { block } = props
  const answerSpace = block.display?.answerSpace
  const figureLabels = figureDisplayLabels(props.question?.figures || [])

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="text-[13px] font-medium text-zinc-500">从题库选择</p>
        <button
          type="button"
          onClick={() => props.onOpenQuestionPicker?.(block.id, props.boxId)}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          <Database className="size-3.5" />浏览题库…
        </button>
      </div>

      {block.questionId ? (
        <div className="flex items-center justify-between rounded-md bg-zinc-50 px-2.5 py-2 dark:bg-zinc-900">
          <span className="text-[11px] text-zinc-500">已关联题目</span>
          <button type="button" onClick={() => props.onUpdate({ questionId: '' })} className="text-[11px] text-red-600 hover:underline dark:text-red-400">清除关联</button>
        </div>
      ) : null}

      {block.questionId ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => props.onEditQuestion?.(block.id)}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            <Pencil className="size-3.5" />编辑题目内容
          </button>
          {block.localContent ? (
            <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50/40 p-2 dark:border-amber-900/50 dark:bg-amber-950/20">
              <p className="text-[11px] leading-4 text-amber-800 dark:text-amber-300">当前显示文档本地版本，修改未回填题库。</p>
              <button type="button" onClick={() => props.onUpdate({ localContent: undefined })} className="text-[11px] font-medium text-red-600 hover:underline dark:text-red-400">恢复题库版本</button>
            </div>
          ) : null}
        </div>
      ) : null}

      <Field label="显示编号">
        <input className={fieldClass} value={block.display?.displayNumberAuto ? '' : (block.display?.displayNumber || '')} onChange={(event) => props.onUpdate({ display: { ...block.display, displayNumber: event.target.value, displayNumberAuto: false } })} placeholder="如 1、例 2" />
      </Field>
      <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
        <input type="checkbox" className="size-3.5 rounded border-zinc-300" checked={Boolean(block.display?.showAnswer)} onChange={(event) => props.onUpdate({ display: { ...block.display, showAnswer: event.target.checked } })} />
        显示答案
      </label>
      <div className="space-y-2 rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
        <p className="text-[13px] font-medium text-zinc-500">回答留空</p>
        <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          <input
            type="checkbox"
            className="size-3.5 rounded border-zinc-300"
            checked={Boolean(block.display?.answerSpace)}
            onChange={(event) => props.onUpdate({ display: {
              ...block.display,
              answerSpace: event.target.checked
                ? (block.display?.answerSpace || { heightMm: 30, style: 'blank' })
                : undefined,
            } })}
          />
          显示回答区
        </label>
        {answerSpace ? (
          <>
            <Field label={`高度 ${Math.round(answerSpace.heightMm)} mm`}>
              <input
                type="range"
                min={5}
                max={200}
                step={1}
                className="mt-2 w-full"
                value={answerSpace.heightMm}
                onChange={(event) => props.onUpdate({ display: { ...block.display, answerSpace: {
                  heightMm: Number(event.target.value),
                  style: answerSpace.style,
                } } }, `answer-space:${block.id}`)}
              />
            </Field>
            <select
              className={fieldClass}
              value={answerSpace.style}
              onChange={(event) => props.onUpdate({ display: { ...block.display, answerSpace: {
                heightMm: answerSpace.heightMm,
                style: event.target.value as 'blank' | 'lines' | 'grid',
              } } })}
            >
              <option value="blank">空白</option>
              <option value="lines">横线</option>
              <option value="grid">方格</option>
            </select>
            <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
              <input
                type="checkbox"
                className="size-3.5 rounded border-zinc-300"
                checked={Boolean(answerSpace.splitAcrossPages)}
                onChange={(event) => props.onUpdate({ display: { ...block.display, answerSpace: { ...answerSpace, splitAcrossPages: event.target.checked } } })}
              />
              跨页不延续留空（下一页直接开始下一题）
            </label>
          </>
        ) : null}
      </div>
      {props.question?.figures?.length ? (
        <div className="space-y-2 rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
          <p className="text-[13px] font-medium text-zinc-500">题图尺寸</p>
          {props.question.figures.map((figure, index) => {
            const key = figure.id || figure.blockId || `figure-${index + 1}`
            const override = block.display?.figureOverrides?.[key]
            const displayLabel = figureLabels[index]
            return (
              <div key={key} className="space-y-1.5">
                <span className="block truncate text-[11px] text-zinc-500" title={String(key)}>{displayLabel}</span>
                <input
                  type="range"
                  min={20}
                  max={240}
                  step={1}
                  className="w-full"
                  value={override?.widthMm ?? 100}
                  aria-label={`${key} 宽度 mm`}
                  onChange={(event) => props.onUpdate({ display: {
                    ...block.display,
                    figureOverrides: {
                      ...block.display?.figureOverrides,
                      [key]: { ...override, widthMm: Number(event.target.value) },
                    },
                  } }, `figure-override:${block.id}:${key}`)}
                />
                <select
                  className={fieldClass}
                  value={override?.alignment || 'center'}
                  onChange={(event) => props.onUpdate({ display: {
                    ...block.display,
                    figureOverrides: {
                      ...block.display?.figureOverrides,
                      [key]: { ...override, widthMm: override?.widthMm ?? 100, alignment: event.target.value as 'left' | 'center' | 'right' },
                    },
                  } })}
                >
                  <option value="left">左对齐</option>
                  <option value="center">居中</option>
                  <option value="right">右对齐</option>
                </select>
              </div>
            )
          })}
        </div>
      ) : null}
      <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
        <input type="checkbox" className="size-3.5 rounded border-zinc-300" checked={Boolean(block.display?.showAnalysis)} onChange={(event) => props.onUpdate({ display: { ...block.display, showAnalysis: event.target.checked } })} />
        显示解析
      </label>
      <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
        <input type="checkbox" className="size-3.5 rounded border-zinc-300" checked={Boolean(block.display?.showScore)} onChange={(event) => props.onUpdate({ display: { ...block.display, showScore: event.target.checked } })} />
        显示分数
      </label>
      <div className="space-y-1.5 border-t border-zinc-100 pt-3 dark:border-zinc-900">
        <p className="text-[13px] font-medium text-zinc-500">插入文档图片</p>
        <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-zinc-200 px-3 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900">
          <ImagePlus className="size-4" />{uploading ? '上传中…' : '上传并插入'}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" className="hidden" disabled={uploading} onChange={async (event) => {
            const file = event.target.files?.[0]
            if (!file) return
            setUploading(true)
            try {
              const asset = await props.onUpload(file)
              const inserted = props.block.display?.insertedFigures || []
              const hasOptions = /(?:^|\n)\s*[A-D][.)]\s/.test(props.question?.stemMarkdown || '')
              props.onUpdate({ display: { ...props.block.display, insertedFigures: [...inserted, { id: `inserted-${Date.now().toString(36)}`, asset: { type: 'documentAsset', assetId: asset.id }, slot: hasOptions ? 'before-options' : 'stem-end', order: inserted.length, layoutPreset: 'block-center' }] } })
            } finally {
              setUploading(false)
              event.target.value = ''
            }
          }} />
        </label>
        {(block.display?.insertedFigures || []).length ? (
          <div className="space-y-2 pt-1">
            {(block.display?.insertedFigures || []).map((figure, index, figures) => (
              <div key={figure.id} className="space-y-1.5 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] text-zinc-500">文档图片 {index + 1}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" aria-label="图片上移" title="上移" disabled={index === 0} onClick={() => props.onUpdate({ display: { ...block.display, insertedFigures: figures.map((item, itemIndex) => itemIndex === index - 1 ? { ...figures[index], order: index - 1 } : itemIndex === index ? { ...figures[index - 1], order: index } : item) } })} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"><ArrowUp className="size-3.5" /></button>
                    <button type="button" aria-label="图片下移" title="下移" disabled={index === figures.length - 1} onClick={() => props.onUpdate({ display: { ...block.display, insertedFigures: figures.map((item, itemIndex) => itemIndex === index ? { ...figures[index + 1], order: index } : itemIndex === index + 1 ? { ...figures[index], order: index + 1 } : item) } })} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"><ArrowDown className="size-3.5" /></button>
                    <button type="button" aria-label="删除图片" title="删除" onClick={() => props.onUpdate({ display: { ...block.display, insertedFigures: figures.filter((item) => item.id !== figure.id).map((item, itemIndex) => ({ ...item, order: itemIndex })) } })} className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"><Trash2 className="size-3.5" /></button>
                  </div>
                </div>
                <select className={fieldClass} value={figure.alignment || 'center'} onChange={(event) => props.onUpdate({ display: { ...block.display, insertedFigures: figures.map((item) => item.id === figure.id ? { ...item, alignment: event.target.value as 'left' | 'center' | 'right' } : item) } })}>
                  <option value="left">左对齐</option>
                  <option value="center">居中</option>
                  <option value="right">右对齐</option>
                </select>
                <select className={fieldClass} value={figure.slot} onChange={(event) => props.onUpdate({ display: { ...block.display, insertedFigures: figures.map((item) => item.id === figure.id ? { ...item, slot: event.target.value as typeof item.slot } : item) } })}>
                  <option value="stem-start">题干开头</option>
                  <option value="stem-end">题干末尾</option>
                  <option value="before-options">选项之前</option>
                  <option value="after-options">选项之后</option>
                  <option value="before-answer">答案之前</option>
                  <option value="after-answer">答案之后</option>
                  <option value="analysis-start">解析开头</option>
                  <option value="analysis-end">解析末尾</option>
                </select>
                <input type="range" min={20} max={240} step={1} className="w-full" aria-label={`文档图片 ${index + 1} 宽度 mm`} value={figure.widthMm || 100} onChange={(event) => props.onUpdate({ display: { ...block.display, insertedFigures: figures.map((item) => item.id === figure.id ? { ...item, widthMm: Number(event.target.value) } : item) } }, `inserted-figure-width:${block.id}:${figure.id}`)} />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
