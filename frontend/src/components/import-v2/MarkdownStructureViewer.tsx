import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import type { MarkdownPreviewResponse, MarkdownStructureToken } from '@/api/importV2'

type FocusKind = 'stem' | 'answer' | 'analysis'

type MarkdownStructureViewerProps = {
  preview: MarkdownPreviewResponse | null
  tokens: MarkdownStructureToken[]
  focusQuestionNo?: string
  focusKind?: FocusKind
}

function lineText(markdown: string, start: number, end: number) {
  return markdown.slice(start, end).replace(/\r?\n$/, '')
}

function tokenIntersectsLine(token: MarkdownStructureToken, line: { start: number; end: number }) {
  return token.start < line.end && token.end > line.start
}

function tokenTone(tokens: MarkdownStructureToken[], focusQuestionNo?: string, focusKind?: FocusKind) {
  if (!tokens.length) return ''
  const focusedKind = focusKind ? `${focusKind}_range` : ''
  if (tokens.some((token) => token.questionNo === focusQuestionNo && (!focusedKind || token.kind === focusedKind))) {
    return 'border-l-amber-400 bg-amber-50/80 dark:bg-amber-950/25'
  }
  if (tokens.some((token) => token.kind === 'analysis_range')) return 'border-l-sky-300 bg-sky-50/60 dark:bg-sky-950/20'
  if (tokens.some((token) => token.kind === 'answer_range')) return 'border-l-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20'
  if (tokens.some((token) => token.kind === 'stem_range')) return 'border-l-indigo-300 bg-indigo-50/50 dark:bg-indigo-950/20'
  if (tokens.some((token) => token.kind === 'metadata_heading')) return 'border-l-amber-300 bg-amber-50/50 dark:bg-amber-950/20'
  if (tokens.some((token) => token.kind === 'answer_table')) return 'border-l-teal-300 bg-teal-50/50 dark:bg-teal-950/20'
  if (tokens.some((token) => token.kind === 'solution_heading')) return 'border-l-fuchsia-300 bg-fuchsia-50/40 dark:bg-fuchsia-950/15'
  if (tokens.some((token) => token.kind === 'question_no')) return 'border-l-zinc-400 bg-zinc-100/70 dark:bg-zinc-900/70'
  if (tokens.some((token) => token.kind === 'page_marker')) return 'border-l-zinc-300 bg-zinc-50 dark:bg-zinc-900/40'
  return ''
}

function tokenLabel(token: MarkdownStructureToken) {
  return ({
    page_marker: token.label,
    question_no: token.label,
    sub_question_no: '小问',
    answer_table: '答案表',
    solution_heading: '答案标题',
    metadata_heading: token.label,
    stem_range: '题干来源',
    answer_range: '答案来源',
    analysis_range: '解析来源',
  } as Record<MarkdownStructureToken['kind'], string>)[token.kind]
}

export function MarkdownStructureViewer({ preview, tokens, focusQuestionNo, focusKind }: MarkdownStructureViewerProps) {
  const [query, setQuery] = useState('')
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  const focusedLine = useMemo(() => {
    const focusedKind = focusKind ? `${focusKind}_range` : ''
    const exact = tokens.find((token) => token.questionNo === focusQuestionNo && (!focusedKind || token.kind === focusedKind))
    if (exact) return exact.lineStart
    return tokens.find((token) => token.questionNo === focusQuestionNo)?.lineStart || preview?.pageMarkers[0]?.lineNo || 1
  }, [focusKind, focusQuestionNo, preview?.pageMarkers, tokens])

  const queryLine = useMemo(() => {
    const text = query.trim().toLowerCase()
    if (!preview || !text) return 0
    return preview.lineOffsets.find((line) => lineText(preview.markdown, line.start, line.end).toLowerCase().includes(text))?.lineNo || 0
  }, [preview, query])

  useEffect(() => {
    const lineNo = queryLine || focusedLine
    if (!lineNo) return
    window.setTimeout(() => {
      lineRefs.current.get(lineNo)?.scrollIntoView({ block: 'center' })
    }, 80)
  }, [focusedLine, queryLine])

  if (!preview) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-zinc-400">
        正在加载模型识别稿...
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-zinc-50/70 dark:bg-zinc-950">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            className="h-8 w-full rounded-md border border-zinc-200 bg-white pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800 dark:bg-zinc-950"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索 Markdown"
          />
        </div>
        <div className="shrink-0 text-[11px] text-zinc-400">
          {preview.lineOffsets.length} 行
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-5">
        {preview.lineOffsets.map((line) => {
          const text = lineText(preview.markdown, line.start, line.end)
          const lineTokens = tokens.filter((token) => tokenIntersectsLine(token, line))
          const matching = query.trim() && text.toLowerCase().includes(query.trim().toLowerCase())
          const tone = tokenTone(lineTokens, focusQuestionNo, focusKind)
          return (
            <div
              key={line.lineNo}
              ref={(node) => {
                if (node) lineRefs.current.set(line.lineNo, node)
                else lineRefs.current.delete(line.lineNo)
              }}
              className={`grid min-h-5 grid-cols-[4.5rem_minmax(0,1fr)] border-l-2 px-0 ${tone || 'border-l-transparent'} ${matching ? 'ring-1 ring-amber-300' : ''}`}
            >
              <div className="select-none border-r border-zinc-200 bg-white/70 px-2 text-right text-[11px] text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950/70">
                {line.lineNo}
              </div>
              <div className="min-w-0 whitespace-pre-wrap break-words px-3 text-zinc-800 dark:text-zinc-200">
                {text || ' '}
                {lineTokens.some((token) => token.lineStart === line.lineNo) ? (
                  <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                    {lineTokens
                      .filter((token) => token.lineStart === line.lineNo)
                      .slice(0, 3)
                      .map((token) => (
                        <span key={token.id} className="rounded border border-zinc-200 bg-white px-1 py-0 text-[10px] font-sans text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                          {tokenLabel(token)}
                        </span>
                      ))}
                  </span>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
