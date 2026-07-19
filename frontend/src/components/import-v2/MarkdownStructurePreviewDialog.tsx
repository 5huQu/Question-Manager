import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, LoaderCircle, PencilLine, Save, X } from 'lucide-react'
import {
  importV2Api,
  type ImportFlowV2ParserConfig,
  type MarkdownPreviewResponse,
  type ParserPreviewResponse,
} from '@/api/importV2'
import { Button } from '@/components/ui'
import {
  MarkdownStructureViewer,
  type MarkdownQuestionJumpRequest,
  type MarkdownScrollAnchor,
} from './MarkdownStructureViewer'
import { ParserDiagnosticsPanel } from './ParserDiagnosticsPanel'

type FocusKind = 'stem' | 'answer' | 'analysis'

const MARKDOWN_EDITOR_LINE_HEIGHT = 20

export function textareaAnchorFromScrollTop(scrollTop: number): MarkdownScrollAnchor {
  const normalizedScrollTop = Math.max(0, scrollTop)
  const lineNo = Math.floor(normalizedScrollTop / MARKDOWN_EDITOR_LINE_HEIGHT) + 1
  return {
    lineNo,
    lineProgress: (normalizedScrollTop % MARKDOWN_EDITOR_LINE_HEIGHT) / MARKDOWN_EDITOR_LINE_HEIGHT,
  }
}

export function textareaScrollTopForAnchor(anchor: MarkdownScrollAnchor) {
  if (!anchor.lineNo) return 0
  return Math.max(0, (anchor.lineNo - 1 + anchor.lineProgress) * MARKDOWN_EDITOR_LINE_HEIGHT)
}

export type MarkdownPreviewDocumentOption = {
  label: string
  ocrDocumentId: string
  role?: 'full' | 'questions' | 'solutions'
  description?: string
}

type MarkdownStructurePreviewDialogProps = {
  open: boolean
  ocrDocumentId?: string
  documentOptions?: MarkdownPreviewDocumentOption[]
  candidateId?: string
  candidateIds?: string[]
  questionNo?: string
  focusKind?: FocusKind
  title?: string
  applying?: boolean
  onApplyConfig?: (config: ImportFlowV2ParserConfig) => void | Promise<unknown>
  onClose: () => void
}

export function MarkdownStructurePreviewDialog({
  open,
  ocrDocumentId,
  documentOptions,
  candidateId,
  candidateIds,
  questionNo,
  focusKind,
  title,
  applying,
  onApplyConfig,
  onClose,
}: MarkdownStructurePreviewDialogProps) {
  const [markdownPreview, setMarkdownPreview] = useState<MarkdownPreviewResponse | null>(null)
  const [parserPreview, setParserPreview] = useState<ParserPreviewResponse | null>(null)
  const [workingConfig, setWorkingConfig] = useState<ImportFlowV2ParserConfig | null>(null)
  const [loading, setLoading] = useState(false)
  const [parserLoading, setParserLoading] = useState(false)
  const [savingMarkdown, setSavingMarkdown] = useState(false)
  const [error, setError] = useState('')
  const [activeOcrDocumentId, setActiveOcrDocumentId] = useState(ocrDocumentId || '')
  const [editingMarkdown, setEditingMarkdown] = useState(false)
  const [markdownDraft, setMarkdownDraft] = useState('')
  const [jumpRequest, setJumpRequest] = useState<MarkdownQuestionJumpRequest | undefined>()
  const markdownTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const markdownLineNumbersRef = useRef<HTMLDivElement | null>(null)
  const scrollAnchorRef = useRef<MarkdownScrollAnchor>({ lineNo: 0, lineProgress: 0 })

  const availableDocuments = useMemo(() => {
    const seen = new Set<string>()
    const items: MarkdownPreviewDocumentOption[] = []
    for (const option of documentOptions || []) {
      if (!option.ocrDocumentId || seen.has(option.ocrDocumentId)) continue
      seen.add(option.ocrDocumentId)
      items.push(option)
    }
    if (ocrDocumentId && !seen.has(ocrDocumentId)) {
      items.unshift({ label: '当前文档', ocrDocumentId })
    }
    return items
  }, [documentOptions, ocrDocumentId])

  const documentIdsSignature = availableDocuments.map((item) => item.ocrDocumentId).join('|')
  const candidateIdsSignature = (candidateIds || []).join('|')
  const preferredOcrDocumentId = ocrDocumentId || availableDocuments[0]?.ocrDocumentId || ''
  const effectiveOcrDocumentId = availableDocuments.some((item) => item.ocrDocumentId === activeOcrDocumentId)
    ? activeOcrDocumentId
    : preferredOcrDocumentId
  const activeDocumentOption = availableDocuments.find((item) => item.ocrDocumentId === effectiveOcrDocumentId) || null
  const markdownLineCount = useMemo(() => markdownDraft.split(/\r?\n/).length, [markdownDraft])
  const markdownLineNumbers = useMemo(() => Array.from({ length: markdownLineCount }, (_, index) => (
    <div key={index} className="h-5 select-none px-2 text-right">
      {index + 1}
    </div>
  )), [markdownLineCount])

  useEffect(() => {
    if (!open) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open])

  useEffect(() => {
    if (!open) return
    setActiveOcrDocumentId(preferredOcrDocumentId)
  }, [documentIdsSignature, open, preferredOcrDocumentId])

  useEffect(() => {
    if (!open) return undefined
    if (!effectiveOcrDocumentId) {
      setMarkdownPreview(null)
      setParserPreview(null)
      setWorkingConfig(null)
      return undefined
    }
    scrollAnchorRef.current = { lineNo: 0, lineProgress: 0 }
    setJumpRequest(undefined)
    let active = true
    setLoading(true)
    setError('')
    setMarkdownPreview(null)
    setParserPreview(null)
    setWorkingConfig(null)
    setEditingMarkdown(false)
    setMarkdownDraft('')
    Promise.all([
      importV2Api.getMarkdownPreview(effectiveOcrDocumentId),
      importV2Api.getParserPreview(effectiveOcrDocumentId, { candidateId, candidateIds, focusQuestionNo: questionNo }),
    ])
      .then(([markdown, parser]) => {
        if (!active) return
        setMarkdownPreview(markdown)
        setParserPreview(parser)
        setWorkingConfig(parser.config)
        setMarkdownDraft(markdown.markdown)
      })
      .catch((err) => {
        if (!active) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [candidateId, candidateIdsSignature, effectiveOcrDocumentId, open, questionNo])

  useEffect(() => {
    if (!editingMarkdown) return
    const textarea = markdownTextareaRef.current
    const anchor = scrollAnchorRef.current
    if (!textarea || !anchor.lineNo) return
    window.requestAnimationFrame(() => {
      textarea.scrollTop = textareaScrollTopForAnchor(anchor)
      if (markdownLineNumbersRef.current) markdownLineNumbersRef.current.scrollTop = textarea.scrollTop
    })
  }, [editingMarkdown])

  function captureTextareaAnchor() {
    const textarea = markdownTextareaRef.current
    if (!textarea) return
    if (markdownLineNumbersRef.current) markdownLineNumbersRef.current.scrollTop = textarea.scrollTop
    scrollAnchorRef.current = textareaAnchorFromScrollTop(textarea.scrollTop)
  }

  async function rerunParserPreview(nextConfig: ImportFlowV2ParserConfig) {
    if (!effectiveOcrDocumentId) return
    setWorkingConfig(nextConfig)
    setParserLoading(true)
    setError('')
    try {
      const parser = await importV2Api.getParserPreview(effectiveOcrDocumentId, {
        config: nextConfig,
        candidateId,
        candidateIds,
        focusQuestionNo: questionNo,
      })
      setParserPreview(parser)
      setWorkingConfig(parser.config)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setParserLoading(false)
    }
  }

  async function saveMarkdownDraft() {
    if (!effectiveOcrDocumentId) return
    captureTextareaAnchor()
    setSavingMarkdown(true)
    setError('')
    try {
      await importV2Api.updateOcrDocumentMarkdown(effectiveOcrDocumentId, markdownDraft)
      const [markdown, parser] = await Promise.all([
        importV2Api.getMarkdownPreview(effectiveOcrDocumentId),
        importV2Api.getParserPreview(effectiveOcrDocumentId, {
          config: workingConfig || undefined,
          candidateId,
          candidateIds,
          focusQuestionNo: questionNo,
        }),
      ])
      setMarkdownPreview(markdown)
      setParserPreview(parser)
      setWorkingConfig(parser.config)
      setMarkdownDraft(markdown.markdown)
      setEditingMarkdown(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingMarkdown(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-4 backdrop-blur-sm">
      <div className="flex h-[min(900px,calc(100vh-2rem))] w-[min(1500px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex shrink-0 flex-col gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-zinc-500" />
              <h2 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {title || '模型识别稿 / 结构预览'}
              </h2>
              {loading || parserLoading ? <LoaderCircle className="size-3.5 animate-spin text-zinc-400" /> : null}
            </div>
            <p className="mt-0.5 truncate text-[11px] text-zinc-500">
              {effectiveOcrDocumentId ? `OCRDocument: ${effectiveOcrDocumentId}` : '未选择 OCRDocument'}
              {activeDocumentOption?.description ? ` · ${activeDocumentOption.description}` : ''}
              {questionNo ? ` · 第 ${questionNo} 题` : ''}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {availableDocuments.length > 1 ? (
              <div
                className="flex h-8 max-w-full items-center gap-0.5 overflow-x-auto rounded-md border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-800 dark:bg-zinc-900"
                role="tablist"
                aria-label="切换识别稿"
              >
                {availableDocuments.map((option) => {
                  const active = option.ocrDocumentId === effectiveOcrDocumentId
                  return (
                    <button
                      key={option.ocrDocumentId}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      title={`${option.label}${option.description ? `：${option.description}` : ''}\n${option.ocrDocumentId}`}
                      onClick={() => setActiveOcrDocumentId(option.ocrDocumentId)}
                      className={`h-7 max-w-32 shrink-0 rounded px-2.5 text-xs font-semibold transition-colors ${
                        active
                          ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-950 dark:text-zinc-50'
                          : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
                      }`}
                    >
                      <span className="block truncate">{option.label}</span>
                    </button>
                  )
                })}
              </div>
            ) : null}
            {editingMarkdown ? (
              <>
                <Button
                  size="sm"
                  icon={savingMarkdown ? LoaderCircle : Save}
                  disabled={savingMarkdown || loading || parserLoading}
                  onClick={saveMarkdownDraft}
                >
                  {savingMarkdown ? '保存中...' : '保存识别稿'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={savingMarkdown}
                  onClick={() => {
                    captureTextareaAnchor()
                    setMarkdownDraft(markdownPreview?.markdown || '')
                    setEditingMarkdown(false)
                  }}
                >
                  取消编辑
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                icon={PencilLine}
                disabled={!markdownPreview || loading || parserLoading}
                onClick={() => setEditingMarkdown(true)}
              >
                编辑识别稿
              </Button>
            )}
            {onApplyConfig ? (
              <Button
                size="sm"
                icon={applying ? LoaderCircle : FileText}
                disabled={!workingConfig || editingMarkdown || loading || parserLoading || savingMarkdown || Boolean(applying)}
                onClick={() => workingConfig && onApplyConfig(workingConfig)}
              >
                {applying ? '重解析中...' : '用当前策略重解析'}
              </Button>
            ) : null}
            <Button size="sm" variant="outline" icon={X} onClick={onClose}>
              关闭
            </Button>
          </div>
        </div>

        {error ? (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_360px]">
          {editingMarkdown ? (
            <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-zinc-50/70 dark:bg-zinc-950">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
                <span className="truncate text-xs font-semibold text-zinc-600 dark:text-zinc-300">编辑 OCR Markdown</span>
                <span className="shrink-0 text-[11px] text-zinc-400">{markdownLineCount} 行</span>
              </div>
              <div className="flex min-h-0 flex-1 overflow-hidden bg-white dark:bg-zinc-950">
                <div
                  ref={markdownLineNumbersRef}
                  data-testid="markdown-draft-line-numbers"
                  aria-hidden="true"
                  className="w-[4.5rem] shrink-0 overflow-hidden border-r border-zinc-200 bg-zinc-50 py-3 font-mono text-[11px] leading-5 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950"
                >
                  {markdownLineNumbers}
                </div>
                <textarea
                  data-testid="markdown-draft-editor"
                  ref={markdownTextareaRef}
                  className="min-h-0 min-w-0 flex-1 resize-none overflow-auto border-0 bg-white px-3 py-3 font-mono text-[12px] leading-5 text-zinc-800 outline-none focus:ring-0 dark:bg-zinc-950 dark:text-zinc-100"
                  value={markdownDraft}
                  spellCheck={false}
                  wrap="off"
                  onChange={(event) => setMarkdownDraft(event.target.value)}
                  onScroll={captureTextareaAnchor}
                />
              </div>
            </div>
          ) : (
            <MarkdownStructureViewer
              preview={markdownPreview}
              tokens={parserPreview?.structures || []}
              focusQuestionNo={questionNo}
              focusKind={focusKind}
              scrollAnchor={scrollAnchorRef.current}
              onScrollAnchorChange={(anchor) => { scrollAnchorRef.current = anchor }}
              jumpRequest={jumpRequest}
              onJumpHandled={(requestId) => {
                setJumpRequest((current) => current?.requestId === requestId ? undefined : current)
              }}
            />
          )}
          <ParserDiagnosticsPanel
            preview={parserPreview}
            config={workingConfig}
            loading={loading || parserLoading || savingMarkdown}
            focusQuestionNo={questionNo}
            onQuestionSelect={(selectedQuestionNo) => {
              setJumpRequest((current) => ({
                questionNo: selectedQuestionNo,
                requestId: (current?.requestId || 0) + 1,
              }))
            }}
            onConfigChange={rerunParserPreview}
          />
        </div>
      </div>
    </div>
  )
}
