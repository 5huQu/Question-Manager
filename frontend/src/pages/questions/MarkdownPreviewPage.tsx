import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, Code2, Copy, Eye, Printer } from 'lucide-react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { collectionsApi } from '@/api/collections'
import { QuestionDocumentMarkdownContent } from '@/components/questions/QuestionContent'
import { Button, Empty } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import type { CollectionExport } from '@/types'

type PreviewVariant = 'student' | 'teacher' | 'error_notebook'
type PreviewData = CollectionExport & { requestKey: string }

export function MarkdownPreviewPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [showSource, setShowSource] = useState(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [draftMarkdown, setDraftMarkdown] = useState('')
  const collectionId = decodeURIComponent(id)
  const requestedVariant = searchParams.get('variant')
  const variant: PreviewVariant = requestedVariant === 'teacher'
    ? 'teacher'
    : requestedVariant === 'error_notebook'
      ? 'error_notebook'
      : 'student'
  const requestKey = useMemo(() => `${collectionId}:${variant}`, [collectionId, variant])
  const notebookSource = useMemo(() => {
    const match = draftMarkdown.match(/^>\s*来源：(.+?)(?:\s{2})?$/m)
    return match?.[1]?.trim() || '试题篮精选'
  }, [draftMarkdown])
  const preview = useAsync<PreviewData>(async () => ({
    ...await collectionsApi.exportCollection(collectionId, { format: 'markdown', variant }),
    requestKey,
  }), [requestKey])

  useEffect(() => {
    if (preview.data?.requestKey === requestKey) {
      setDraftMarkdown(preview.data.content || '')
    }
  }, [preview.data, requestKey])

  function switchVariant(next: PreviewVariant) {
    setSearchParams({ variant: next })
  }

  async function copyMarkdown() {
    const content = draftMarkdown
    if (!content) return

    try {
      await navigator.clipboard.writeText(content)
      setCopyStatus('success')
    } catch {
      setCopyStatus('error')
    }

    window.setTimeout(() => setCopyStatus('idle'), 2000)
  }

  return (
    <section className="mock-page-root flex min-h-[calc(100vh-6rem)] w-full select-none flex-col overflow-y-auto bg-zinc-100/70 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <style>{`
        .markdown-preview-paper {
          box-sizing: border-box;
          width: min(210mm, 100%);
          min-height: 297mm;
          margin: 0 auto;
          padding: 20mm 22mm 24mm;
          background: #fff;
          color: #18181b;
          font-family: "Songti SC", "STSong", "SimSun", "Noto Serif CJK SC", serif;
          font-size: 12pt;
          line-height: 1.72;
          letter-spacing: 0.01em;
          box-shadow: 0 12px 36px rgb(24 24 27 / 0.10);
        }
        .markdown-preview-paper-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 1.8rem;
          color: #a1a1aa;
          font-size: 10.5pt;
          line-height: 1.2;
        }
        .markdown-preview-paper .markdown-content {
          color: inherit;
          font: inherit;
        }
        .markdown-preview-paper .markdown-content h1 {
          margin: 0 0 1.5rem;
          text-align: center;
          font-size: 20pt;
          font-weight: 650;
          line-height: 1.25;
          letter-spacing: 0.08em;
        }
        .markdown-preview-paper .markdown-content h2 {
          margin: 1.45rem 0 0.7rem;
          padding-bottom: 0.22rem;
          border-bottom: 0.75px solid #27272a;
          font-size: 13.5pt;
          font-weight: 650;
          line-height: 1.35;
          letter-spacing: 0.02em;
        }
        .markdown-preview-paper .markdown-content h3 {
          margin: 1.15rem 0 0.5rem;
          font-size: 12.5pt;
          font-weight: 650;
        }
        .markdown-preview-paper .markdown-content hr {
          display: none;
        }
        .markdown-preview-paper .markdown-content p {
          margin: 0.48rem 0;
        }
        .markdown-preview-paper .markdown-content blockquote {
          margin: -0.65rem auto 1.4rem;
          padding: 0;
          border: 0;
          color: #71717a;
          text-align: center;
          font-size: 10.5pt;
          line-height: 1.6;
        }
        .markdown-preview-paper .markdown-content blockquote p {
          display: inline;
          margin: 0;
        }
        .markdown-preview-paper .question-content {
          margin: 0.35rem 0 1.15rem;
          break-inside: avoid;
        }
        .markdown-preview-paper .question-content > .markdown-content:first-child > p:first-child > strong:first-child {
          display: inline-block;
          min-width: 1.8em;
          margin-right: 0.35em;
          font-family: "Times New Roman", "STIX Two Text", serif;
          font-weight: 700;
        }
        .markdown-preview-paper .choice-options {
          margin-top: 0.5rem;
          padding-top: 0;
          border-top: 0;
          column-gap: 1.35rem;
          row-gap: 0.35rem;
        }
        .markdown-preview-paper .choice-option {
          line-height: 1.6;
        }
        .markdown-preview-paper .choice-label {
          color: #27272a;
          font-family: "Times New Roman", "STIX Two Text", serif;
          font-weight: 400;
        }
        .markdown-preview-paper .katex {
          font-size: 1.02em;
        }
        .markdown-preview-paper .katex-display {
          margin: 0.65rem 0;
        }
        .markdown-preview-paper .markdown-content img {
          display: block;
          width: auto;
          max-width: min(72%, 30rem);
          max-height: 18rem;
          margin: 0.8rem auto;
          border: 0;
          border-radius: 0;
          object-fit: contain;
        }
        .markdown-preview-paper .question-table-wrap {
          border-radius: 0;
          box-shadow: none;
        }
        .markdown-preview-paper-error-notebook .markdown-content h1,
        .markdown-preview-paper-error-notebook .markdown-content blockquote {
          display: none;
        }
        .markdown-preview-paper-error-notebook .markdown-content h2:first-child {
          margin-top: 0;
        }
        .markdown-preview-paper-error-notebook .question-content {
          margin-bottom: 0.9rem;
        }
        @media screen and (max-width: 760px) {
          .markdown-preview-paper {
            min-height: 0;
            padding: 1.5rem 1.25rem 2rem;
            font-size: 11pt;
          }
          .markdown-preview-paper-header {
            margin-bottom: 1.25rem;
          }
          .markdown-preview-paper .choice-options-quad {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media print {
          body {
            background-color: white !important;
            color: black !important;
          }
          aside, nav, header, .no-print, button, .button {
            display: none !important;
          }
          main {
            padding: 0 !important;
            margin: 0 !important;
            min-height: auto !important;
            background: white !important;
          }
          section {
            max-width: 100% !important;
            width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
            border: none !important;
            box-shadow: none !important;
          }
          article {
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
            margin: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            background: white !important;
            color: black !important;
          }
          .markdown-preview-paper {
            min-height: 0 !important;
            font-size: 12pt !important;
          }
          @page {
            size: A4;
            margin: 20mm 22mm 24mm;
          }
        }
      `}</style>
      <header className="no-print sticky top-0 z-20 flex flex-col gap-3 border-b border-zinc-200 bg-white/95 px-6 py-3.5 text-left shadow-xs backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button icon={ArrowLeft} variant="outline" onClick={() => navigate(-1)}>返回</Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Markdown 排版预览</h1>
              <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">A4 · 210 × 297 mm</span>
            </div>
            <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">实时渲染，可切换源码、复制或打印为 PDF。</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900">
            {(['student', 'teacher', 'error_notebook'] as const).map((item) => (
              <button
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${variant === item ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-950 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'}`}
                key={item}
                onClick={() => switchVariant(item)}
                type="button"
              >
                {item === 'student' ? '学生版' : item === 'teacher' ? '教师版' : '错题本'}
              </button>
            ))}
          </div>
          <Button icon={showSource ? Eye : Code2} variant="outline" onClick={() => setShowSource(!showSource)}>
            {showSource ? '渲染预览' : 'Markdown 源码'}
          </Button>
          <Button
            disabled={!draftMarkdown}
            icon={copyStatus === 'success' ? Check : Copy}
            variant="outline"
            onClick={() => void copyMarkdown()}
          >
            {copyStatus === 'success' ? '已复制' : copyStatus === 'error' ? '复制失败' : '复制 Markdown'}
          </Button>
          {!showSource && (
            <Button icon={Printer} onClick={() => window.print()}>
              打印 / 导出 A4 PDF
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 p-4 sm:p-6 lg:p-8">
        {preview.loading && !preview.data ? <Empty text="正在生成预览..." /> : null}
        {preview.error ? <Empty text={preview.error} /> : null}
        {preview.data ? (
          showSource ? (
            <div className="mx-auto max-w-5xl overflow-hidden rounded-xl border border-zinc-200 bg-zinc-950 shadow-sm dark:border-zinc-800">
              <div className="border-b border-zinc-800 bg-zinc-900/70 px-5 py-2.5 text-xs text-zinc-400">
                临时编辑草稿，仅在当前页面有效；刷新页面后将恢复系统默认内容。
              </div>
              <textarea
                aria-label="Markdown 源码编辑器"
                className="min-h-[60vh] w-full resize-y bg-transparent p-5 font-mono text-xs leading-6 text-zinc-100 outline-none"
                spellCheck={false}
                value={draftMarkdown}
                onChange={(event) => setDraftMarkdown(event.target.value)}
              />
            </div>
          ) : (
            <article className={`markdown-preview-paper select-text ${variant === 'error_notebook' ? 'markdown-preview-paper-error-notebook' : ''}`}>
              {variant === 'error_notebook' ? (
                <div className="markdown-preview-paper-header">
                  <span>错题本</span>
                  <span>{notebookSource}</span>
                </div>
              ) : null}
              <QuestionDocumentMarkdownContent className="markdown-preview-paper-content" content={draftMarkdown} />
            </article>
          )
        ) : null}
      </div>
    </section>
  )
}

export default MarkdownPreviewPage
