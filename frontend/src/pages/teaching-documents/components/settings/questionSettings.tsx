import { useState } from 'react'
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, Database, ImagePlus, Pencil, Trash2 } from 'lucide-react'
import type { QuestionItem } from '@/types'
import type { QuestionBlock, TeachingBlock } from '@/types/teachingDocument'
import { figureDisplayLabels, orderQuestionFiguresByUsage, parseChoiceQuestion, questionFigureUsage } from '@/utils/questionDisplay'
import { InspectorSlider } from '@/components/ui/InspectorSlider'
import { DEFAULT_QUESTION_FIGURE_WIDTH_MM } from '@/utils/teachingDocument/figureLayoutPresets'
import { Divider, Field, fieldClass, Section } from './common'

const DEFAULT_GROUP_HEIGHT_MM = 50

export function QuestionSettings(props: {
  mode?: 'content' | 'style'
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
  const contentMode = props.mode !== 'style'
  const styleMode = props.mode === 'style'
  const answerSpace = block.display?.answerSpace
  const orderedFigures = orderQuestionFiguresByUsage(props.question?.figures || [])
  const figureLabels = figureDisplayLabels(orderedFigures)
  const hasChoices = Boolean(props.question && parseChoiceQuestion(props.question.stemMarkdown)?.options.length)

  return (
    <div className="space-y-3">
      {contentMode ? <>
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
      <Section title="回答留空">
        <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          <input
            type="checkbox"
            className="size-3.5 rounded border-zinc-300"
            checked={Boolean(block.display?.answerSpace)}
            onChange={(event) => props.onUpdate({ display: {
              ...block.display,
              answerSpace: event.target.checked
                ? (block.display?.answerSpace || { heightMm: 40, style: 'blank' })
                : undefined,
            } })}
          />
          显示回答区
        </label>
        {answerSpace ? (
          <div className="space-y-3 pt-1">
            <InspectorSlider
              label="留空高度"
              value={Math.round(answerSpace.heightMm)}
              min={5}
              max={200}
              step={1}
              unit="mm"
              presets={[15, 40, 50, 80]}
              onChange={(val) => props.onUpdate({ display: { ...block.display, answerSpace: {
                heightMm: val,
                style: answerSpace.style,
              } } }, `answer-space:${block.id}`)}
            />
            <Field label="留空样式">
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
            </Field>
            <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
              <input
                type="checkbox"
                className="size-3.5 rounded border-zinc-300"
                checked={Boolean(answerSpace.splitAcrossPages)}
                onChange={(event) => props.onUpdate({ display: { ...block.display, answerSpace: { ...answerSpace, splitAcrossPages: event.target.checked } } })}
              />
              跨页不延续留空（下一页直接开始下一题）
            </label>
          </div>
        ) : null}
      </Section>
      </> : null}

      {styleMode && hasChoices ? (
        <Section title="选项布局">
          <ChoiceLayoutControl
            value={block.display?.choiceLayout || 'auto'}
            onChange={(choiceLayout) => props.onUpdate({ display: { ...block.display, choiceLayout } })}
          />
          <p className="text-[11px] leading-4 text-zinc-500">自动会按当前纸张宽度和选项实际内容测量；固定布局会同时作用于预览、分页和打印。</p>
        </Section>
      ) : null}

      {styleMode ? <Divider /> : null}

      {styleMode && props.question?.figures?.length ? (
        <Section title="题图尺寸">
          {orderedFigures.map((figure, index) => {
            const key = figure.id || figure.blockId || `figure-${index + 1}`
            const override = block.display?.figureOverrides?.[key]
            const displayLabel = figureLabels[index]
            const sameUsageCount = orderedFigures.slice(index).findIndex((candidate) => questionFigureUsage(candidate) !== questionFigureUsage(figure))
            const availableInSection = sameUsageCount < 0 ? orderedFigures.length - index : sameUsageCount
            return (
              <div key={key} className="space-y-2 border-b border-zinc-200/60 pb-3 dark:border-zinc-800/60 last:border-b-0">
                <InspectorSlider
                  label={displayLabel}
                  value={override?.widthMm ?? DEFAULT_QUESTION_FIGURE_WIDTH_MM}
                  min={20}
                  max={240}
                  step={1}
                  unit="mm"
                  presets={[20, 30, 40, 50]}
                  onChange={(val) => props.onUpdate({ display: {
                    ...block.display,
                    figureOverrides: {
                      ...block.display?.figureOverrides,
                      [key]: { ...override, widthMm: val },
                    },
                  } }, `figure-override:${block.id}:${key}`)}
                />
                <AlignmentControl
                  value={override?.alignment || 'center'}
                  onChange={(alignment) => props.onUpdate({ display: {
                    ...block.display,
                    figureOverrides: {
                      ...block.display?.figureOverrides,
                      [key]: { ...override, widthMm: override?.widthMm ?? DEFAULT_QUESTION_FIGURE_WIDTH_MM, alignment, layoutPreset: undefined },
                    },
                  } })}
                />
                <WrapModeControl
                  value={override?.textWrap || 'top-bottom'}
                  disabled={Boolean(override?.groupWithNext)}
                  onChange={(textWrap) => props.onUpdate({ display: {
                    ...block.display,
                    figureOverrides: {
                      ...block.display?.figureOverrides,
                      [key]: {
                        ...override,
                        textWrap: textWrap === 'top-bottom' ? undefined : textWrap,
                        wrapGapMm: textWrap === 'top-bottom' ? undefined : (override?.wrapGapMm ?? 4),
                      },
                    },
                  } })}
                />
                {override?.textWrap === 'square-left' || override?.textWrap === 'square-right' ? (
                  <InspectorSlider
                    label="文字间距"
                    value={override.wrapGapMm ?? 4}
                    min={0}
                    max={12}
                    step={1}
                    unit="mm"
                    presets={[0, 2, 4, 6]}
                    onChange={(val) => props.onUpdate({ display: {
                      ...block.display,
                      figureOverrides: {
                        ...block.display?.figureOverrides,
                        [key]: { ...override, wrapGapMm: val },
                      },
                    } }, `question-figure-wrap-gap:${block.id}:${key}`)}
                  />
                ) : null}
                <Field label="图片排版">
                  <select
                    className={fieldClass}
                    value={override?.groupWithNext ? String(override.groupColumns || 2) : 'single'}
                    onChange={(event) => props.onUpdate({ display: {
                      ...block.display,
                      figureOverrides: {
                        ...block.display?.figureOverrides,
                        [key]: {
                          ...override,
                          ...(event.target.value !== 'single'
                            ? {
                                widthMm: override?.widthMm ?? DEFAULT_QUESTION_FIGURE_WIDTH_MM,
                                groupWithNext: true,
                                groupColumns: Number(event.target.value) as 2 | 3 | 4,
                              }
                            : { groupWithNext: undefined, groupColumns: undefined, groupMatchHeight: undefined, groupHeightMm: undefined }),
                          ...(event.target.value !== 'single'
                            ? { textWrap: undefined, wrapGapMm: undefined }
                            : {}),
                        },
                      },
                    } })}
                  >
                    <option value="single">单独一行</option>
                    <option value="2" disabled={availableInSection < 2}>与后 1 张并排（共 2 张）</option>
                    <option value="3" disabled={availableInSection < 3}>与后 2 张并排（共 3 张）</option>
                    <option value="4" disabled={availableInSection < 4}>与后 3 张并排（共 4 张）</option>
                  </select>
                </Field>
                {override?.groupWithNext ? (
                  <div className="space-y-2 rounded-md bg-zinc-50/70 p-2 dark:bg-zinc-900/50">
                    <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                      <input
                        type="checkbox"
                        className="size-3.5 rounded border-zinc-300"
                        checked={Boolean(override.groupMatchHeight)}
                        onChange={(event) => props.onUpdate({ display: {
                          ...block.display,
                          figureOverrides: {
                            ...block.display?.figureOverrides,
                            [key]: {
                              ...override,
                              groupMatchHeight: event.target.checked || undefined,
                              groupHeightMm: event.target.checked ? (override.groupHeightMm ?? DEFAULT_GROUP_HEIGHT_MM) : undefined,
                            },
                          },
                        } })}
                      />
                      并排图片统一高度（保持比例）
                    </label>
                    {override.groupMatchHeight ? (
                      <InspectorSlider
                        label="统一高度"
                        value={override.groupHeightMm ?? DEFAULT_GROUP_HEIGHT_MM}
                        min={15}
                        max={160}
                        step={1}
                        unit="mm"
                        presets={[30, 40, 50, 60, 80]}
                        onChange={(val) => props.onUpdate({ display: {
                          ...block.display,
                          figureOverrides: {
                            ...block.display?.figureOverrides,
                            [key]: { ...override, groupMatchHeight: true, groupHeightMm: val },
                          },
                        } }, `figure-group-height:${block.id}:${key}`)}
                      />
                    ) : null}
                    <p className="text-[11px] leading-4 text-zinc-500">只会合并同一用途的后续图片；版心不足时会整体缩小，图片不会变形。</p>
                  </div>
                ) : null}
              </div>
            )
          })}
        </Section>
      ) : null}
      {contentMode ? <>
      <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
        <input type="checkbox" className="size-3.5 rounded border-zinc-300" checked={Boolean(block.display?.showAnalysis)} onChange={(event) => props.onUpdate({ display: { ...block.display, showAnalysis: event.target.checked } })} />
        显示解析
      </label>
      <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
        <input type="checkbox" className="size-3.5 rounded border-zinc-300" checked={Boolean(block.display?.showScore)} onChange={(event) => props.onUpdate({ display: { ...block.display, showScore: event.target.checked } })} />
        显示分数
      </label>
      </> : null}
      {styleMode ? <>
      <Divider />

      <Section title="插入文档图片">
        <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-zinc-200 px-3 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900">
          <ImagePlus className="size-3.5" />{uploading ? '上传中…' : '上传并插入'}
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
          <div className="space-y-3 pt-1">
            {(block.display?.insertedFigures || []).map((figure, index, figures) => (
              <div key={figure.id} className="space-y-2 border-b border-zinc-200/60 pb-3 dark:border-zinc-800/60 last:border-b-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] font-medium text-zinc-500">文档图片 {index + 1}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" aria-label="图片上移" title="上移" disabled={index === 0} onClick={() => props.onUpdate({ display: { ...block.display, insertedFigures: figures.map((item, itemIndex) => itemIndex === index - 1 ? { ...figures[index], order: index - 1 } : itemIndex === index ? { ...figures[index - 1], order: index } : item) } })} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"><ArrowUp className="size-3.5" /></button>
                    <button type="button" aria-label="图片下移" title="下移" disabled={index === figures.length - 1} onClick={() => props.onUpdate({ display: { ...block.display, insertedFigures: figures.map((item, itemIndex) => itemIndex === index ? { ...figures[index + 1], order: index } : itemIndex === index + 1 ? { ...figures[index], order: index + 1 } : item) } })} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"><ArrowDown className="size-3.5" /></button>
                    <button type="button" aria-label="删除图片" title="删除" onClick={() => props.onUpdate({ display: { ...block.display, insertedFigures: figures.filter((item) => item.id !== figure.id).map((item, itemIndex) => ({ ...item, order: itemIndex })) } })} className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"><Trash2 className="size-3.5" /></button>
                  </div>
                </div>
                <AlignmentControl
                  value={figure.alignment || 'center'}
                  onChange={(alignment) => props.onUpdate({ display: { ...block.display, insertedFigures: figures.map((item) => item.id === figure.id ? { ...item, alignment, layoutPreset: undefined } : item) } })}
                />
                <Field label="插入位置">
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
                </Field>
                <WrapModeControl
                  value={figure.textWrap || 'top-bottom'}
                  onChange={(textWrap) => props.onUpdate({ display: {
                    ...block.display,
                    insertedFigures: figures.map((item) => item.id === figure.id ? {
                      ...item,
                      textWrap: textWrap === 'top-bottom' ? undefined : textWrap,
                      wrapGapMm: textWrap === 'top-bottom' ? undefined : (item.wrapGapMm ?? 4),
                    } : item),
                  } })}
                />
                {figure.textWrap === 'square-left' || figure.textWrap === 'square-right' ? (
                  <InspectorSlider
                    label="文字间距"
                    value={figure.wrapGapMm ?? 4}
                    min={0}
                    max={12}
                    step={1}
                    unit="mm"
                    presets={[0, 2, 4, 6]}
                    onChange={(val) => props.onUpdate({ display: {
                      ...block.display,
                      insertedFigures: figures.map((item) => item.id === figure.id ? { ...item, wrapGapMm: val } : item),
                    } }, `inserted-figure-wrap-gap:${block.id}:${figure.id}`)}
                  />
                ) : null}
                <InspectorSlider
                  label="图片宽度"
                  value={figure.widthMm || DEFAULT_QUESTION_FIGURE_WIDTH_MM}
                  min={20}
                  max={240}
                  step={1}
                  unit="mm"
                  presets={[20, 30, 40, 50]}
                  onChange={(val) => props.onUpdate({ display: { ...block.display, insertedFigures: figures.map((item) => item.id === figure.id ? { ...item, widthMm: val } : item) } }, `inserted-figure-width:${block.id}:${figure.id}`)}
                />
              </div>
            ))}
          </div>
        ) : null}
      </Section>
      </> : null}
    </div>
  )
}

type WrapMode = 'top-bottom' | 'square-left' | 'square-right'

type ChoiceLayout = NonNullable<NonNullable<QuestionBlock['display']>['choiceLayout']>

function ChoiceLayoutControl(props: { value: ChoiceLayout; onChange: (value: ChoiceLayout) => void }) {
  const options: Array<{ value: ChoiceLayout; label: string; columns: number }> = [
    { value: 'auto', label: '自动', columns: 2 },
    { value: 'four', label: '1×4', columns: 4 },
    { value: 'two', label: '2×2', columns: 2 },
    { value: 'one', label: '4×1', columns: 1 },
  ]
  return (
    <div className="space-y-1">
      <span className="text-[13px] font-medium text-zinc-500">本题选项排布</span>
      <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="本题选项排布">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-label={option.label}
            aria-checked={props.value === option.value}
            title={option.label}
            onClick={() => props.onChange(option.value)}
            className={`flex h-12 flex-col items-center justify-center gap-0.5 rounded-md border transition-colors ${
              props.value === option.value
                ? 'border-zinc-900 bg-zinc-100 text-zinc-900 dark:border-zinc-100 dark:bg-zinc-800 dark:text-zinc-50'
                : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900'
            }`}
          >
            <span className="grid h-5 w-8 gap-0.5" style={{ gridTemplateColumns: `repeat(${option.columns}, minmax(0, 1fr))` }} aria-hidden="true">
              {[0, 1, 2, 3].map((item) => <i key={item} className="rounded-[1px] border border-current" />)}
            </span>
            <span className="text-[10px] leading-none">{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

type FigureAlignment = 'left' | 'center' | 'right'

function AlignmentControl(props: { value: FigureAlignment; onChange: (value: FigureAlignment) => void }) {
  const options: Array<{ value: FigureAlignment; label: string; icon: typeof AlignLeft }> = [
    { value: 'left', label: '左对齐', icon: AlignLeft },
    { value: 'center', label: '居中', icon: AlignCenter },
    { value: 'right', label: '右对齐', icon: AlignRight },
  ]
  return (
    <div className="space-y-1">
      <span className="text-[13px] font-medium text-zinc-500">对齐</span>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="对齐">
        {options.map((option) => {
          const Icon = option.icon
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-label={option.label}
              aria-checked={props.value === option.value}
              title={option.label}
              onClick={() => props.onChange(option.value)}
              className={`flex h-12 flex-col items-center justify-center gap-0.5 rounded-md border transition-colors ${
                props.value === option.value
                  ? 'border-zinc-900 bg-zinc-100 text-zinc-900 dark:border-zinc-100 dark:bg-zinc-800 dark:text-zinc-50'
                  : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900'
              }`}
            >
              <Icon className="size-4" />
              <span className="text-[10px] leading-none">{option.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function WrapModeControl(props: { value: WrapMode; onChange: (value: WrapMode) => void; disabled?: boolean }) {
  const options: Array<{ value: WrapMode; label: string; imageSide?: 'left' | 'right' }> = [
    { value: 'top-bottom', label: '嵌入型' },
    { value: 'square-left', label: '左侧文字', imageSide: 'right' },
    { value: 'square-right', label: '右侧文字', imageSide: 'left' },
  ]
  return (
    <div className="space-y-1">
      <span className="text-[13px] font-medium text-zinc-500">文字环绕</span>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="文字环绕">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={props.value === option.value}
            disabled={props.disabled}
            title={option.label}
            onClick={() => props.onChange(option.value)}
            className={`flex h-14 flex-col items-center justify-center gap-1 rounded-md border text-[10px] transition-colors ${
              props.value === option.value
                ? 'border-zinc-900 bg-zinc-100 text-zinc-900 dark:border-zinc-100 dark:bg-zinc-800 dark:text-zinc-50'
                : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900'
            } disabled:cursor-not-allowed disabled:opacity-40`}
          >
            <span className="relative flex h-6 w-10 items-center justify-center" aria-hidden="true">
              {option.imageSide ? (
                <>
                  <span className={`absolute ${option.imageSide === 'left' ? 'left-0' : 'right-0'} h-5 w-4 rounded-sm border-2 border-current bg-white dark:bg-zinc-900`} />
                  <span className={`flex w-7 flex-col gap-0.5 ${option.imageSide === 'left' ? 'ml-3' : 'mr-3'}`}><i className="h-0.5 w-full bg-current" /><i className="h-0.5 w-5/6 bg-current" /><i className="h-0.5 w-2/3 bg-current" /></span>
                </>
              ) : (
                <span className="flex flex-col items-center gap-0.5"><span className="h-4 w-6 rounded-sm border-2 border-current bg-white dark:bg-zinc-900" /><i className="h-0.5 w-8 bg-current" /></span>
              )}
            </span>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
