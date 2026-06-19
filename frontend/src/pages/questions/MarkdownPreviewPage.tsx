import { useMemo, useState } from 'react'
import { ArrowLeft, Code2, Eye, Printer } from 'lucide-react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, jsonHeaders } from '@/api/client'
import { QuestionDocumentMarkdownContent } from '@/components/questions/QuestionContent'
import { Button, Empty } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import type { CollectionExport } from '@/types'

type PreviewVariant = 'student' | 'teacher'

export function MarkdownPreviewPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [showSource, setShowSource] = useState(false)
  const collectionId = decodeURIComponent(id)
  const variant: PreviewVariant = searchParams.get('variant') === 'teacher' ? 'teacher' : 'student'
  const requestKey = useMemo(() => `${collectionId}:${variant}`, [collectionId, variant])
  const preview = useAsync<CollectionExport>(() => api(`/api/question-bank/collections/${encodeURIComponent(collectionId)}/export`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ format: 'markdown', variant }),
  }), [requestKey])

  function switchVariant(next: PreviewVariant) {
    setSearchParams({ variant: next })
  }

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <style>{`
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
          @page {
            size: A4;
            margin: 20mm;
          }
        }
      `}</style>
      <header className="flex flex-col gap-3 rounded-2xl border bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:flex-row sm:items-center sm:justify-between no-print">
        <div className="flex items-center gap-3">
          <Button icon={ArrowLeft} variant="outline" onClick={() => navigate(-1)}>返回</Button>
          <div>
            <h1 className="text-lg font-semibold">Markdown 预览</h1>
            <p className="mt-0.5 text-xs text-zinc-500">仅实时显示预览，不生成或下载 Markdown 文件。</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-700 dark:bg-zinc-950">
            {(['student', 'teacher'] as const).map((item) => (
              <button
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${variant === item ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-white' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'}`}
                key={item}
                onClick={() => switchVariant(item)}
                type="button"
              >
                {item === 'student' ? '学生版' : '教师版'}
              </button>
            ))}
          </div>
          <Button icon={showSource ? Eye : Code2} variant="outline" onClick={() => setShowSource(!showSource)}>
            {showSource ? '渲染预览' : 'Markdown 源码'}
          </Button>
          {!showSource && (
            <Button icon={Printer} onClick={() => window.print()}>
              打印 / 导出 A4 PDF
            </Button>
          )}
        </div>
      </header>

      {preview.loading && !preview.data ? <Empty text="正在生成预览..." /> : null}
      {preview.error ? <Empty text={preview.error} /> : null}
      {preview.data ? (
        showSource ? (
          <pre className="min-h-[60vh] overflow-auto whitespace-pre-wrap rounded-2xl border bg-zinc-950 p-5 text-xs leading-6 text-zinc-100 shadow-sm">
            {preview.data.content || ''}
          </pre>
        ) : (
          <article className="min-h-[60vh] rounded-2xl border bg-white px-6 py-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:px-10 lg:px-14">
            <QuestionDocumentMarkdownContent className="text-[15px] leading-7" content={preview.data.content || ''} />
          </article>
        )
      ) : null}
    </section>
  )
}

export default MarkdownPreviewPage
