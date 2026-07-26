/**
 * TeachingDocument 打印路由页面
 * 由 Electron 隐藏窗口加载（BrowserRouter 真实路径 /print/teaching-document），
 * 用于 Chromium PDF 导出。复用 A4 分页组件和同一套 CSS，不重新实现排版逻辑。
 *
 * 数据加载约定：
 * - 收集顶层及 box 子块全部 questionId，通过 questionBank API wrapper 加载真实题目；
 * - FigureAssetRef 复用安全 resolver（questionFigure / documentAsset / legacyPath），
 *   禁止拼接本地绝对路径；
 * - 后端实际 revision 与请求 revision 不一致时禁止导出（通知主进程失败）；
 * - 仅在渲染 readiness 通过后 notifyReady。
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { FigureAssetRef, TeachingDocumentV1 } from '@/types/teachingDocument'
import { questionBankApi } from '@/api/questionBank'
import { teachingDocumentsApi, type TeachingDocumentRecord } from '@/api/teachingDocuments'
import { ApiError } from '@/api/client'
import {
  DEFAULT_A4_PAPER,
  measureTeachingDocumentBoxes,
  measureTeachingDocument,
  measureTeachingDocumentParagraphs,
  measureTeachingDocumentQuestions,
  measureBoxChildQuestions,
  paginateTeachingDocument,
  createDefaultPrintLayout,
  effectivePaperMetrics,
  evaluateExportReadiness,
  TEACHING_DOM,
  waitForRenderReadiness,
  type PaginationResult,
  type RenderReadinessResult,
} from '@/utils/teachingDocument'
import {
  TeachingDocumentRenderer,
} from '@/components/teaching-document/TeachingDocumentRenderer'
import {
  type FigureResolution,
  type QuestionResolution,
} from '@/components/teaching-document/blocks/BlockRenderer'
import { PaperPageView } from '@/components/teaching-document/PaperPageView'
import { assetUrl } from '@/utils/questionDisplay'
import '@/components/teaching-document/teaching-document.css'
import '@/components/teaching-document/print.css'

type PageState = 'loading' | 'error' | 'measuring' | 'ready'

export default function TeachingDocumentPrintPage() {
  const [searchParams] = useSearchParams()
  const docId = searchParams.get('docId') || ''
  const revisionParam = Number(searchParams.get('revision') || '0')

  const [state, setState] = useState<PageState>('loading')
  const [error, setError] = useState('')
  const [record, setRecord] = useState<TeachingDocumentRecord | null>(null)
  const [pagination, setPagination] = useState<PaginationResult | null>(null)
  const [readiness, setReadiness] = useState<RenderReadinessResult | null>(null)
  const [questionMap, setQuestionMap] = useState<Record<string, QuestionResolution>>({})

  const measurementRootRef = useRef<HTMLDivElement>(null)
  const generationRef = useRef(0)
  const notifiedRef = useRef(false)

  const paper = DEFAULT_A4_PAPER
  const printLayout = useMemo(() => createDefaultPrintLayout(paper), [paper])
  // 页眉页脚参与分页有效高度（保守统一扣除，首页 showOnFirstPage=false 同样扣除）。
  const metrics = useMemo(() => effectivePaperMetrics(printLayout), [printLayout])

  const document: TeachingDocumentV1 | null = record?.content || null

  // ─── revision 校验：后端实际 revision 与请求不一致时禁止导出 ────────────────
  const revisionMismatch = Boolean(record) && record!.revision !== revisionParam

  // ─── 收集顶层及 box 子块全部 questionId ─────────────────────────────────────
  const questionIds = useMemo(() => {
    const ids = new Set<string>()
    for (const block of document?.content || []) {
      if (block.type === 'question' && block.questionId) ids.add(block.questionId)
      if (block.type === 'box') {
        for (const child of block.children) {
          if (child.type === 'question' && child.questionId) ids.add(child.questionId)
        }
      }
    }
    return [...ids]
  }, [document])

  // ─── 拉取文档 ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!docId) {
      setError('缺少文档 ID 参数')
      setState('error')
      return
    }
    teachingDocumentsApi.getDocument(docId)
      .then((rec) => setRecord(rec))
      .catch((err) => {
        setError(err instanceof Error ? err.message : '文档加载失败')
        setState('error')
      })
  }, [docId])

  // ─── 通过 questionBank API wrapper 加载真实题目（支持 missing / error） ─────
  useEffect(() => {
    const missing = questionIds.filter((id) => !questionMap[id])
    if (!missing.length) return
    setQuestionMap((current) => ({
      ...current,
      ...Object.fromEntries(missing.map((id) => [id, { status: 'loading' as const }])),
    }))
    for (const id of missing) {
      questionBankApi.getItem(id)
        .then((question) => setQuestionMap((current) => ({ ...current, [id]: question })))
        .catch((err) => setQuestionMap((current) => ({
          ...current,
          [id]: err instanceof ApiError && err.status === 404
            ? { status: 'missing' as const, message: `题目不存在（ID: ${id}）` }
            : { status: 'error' as const, message: err instanceof Error ? err.message : String(err) },
        })))
    }
  }, [questionIds, questionMap])

  // 全部题目进入稳定态（question / missing / error，无 loading）后才开始测量。
  const questionsSettled = questionIds.every((id) => {
    const resolution = questionMap[id]
    return resolution !== undefined
      && !('status' in resolution && resolution.status === 'loading')
  })

  useEffect(() => {
    if (!record) return
    if (revisionMismatch) {
      setError(`文档 revision 不一致：请求 r${revisionParam}，服务端实际 r${record.revision}，禁止导出。`)
      setState('error')
      return
    }
    if (questionsSettled) setState('measuring')
  }, [record, revisionMismatch, questionsSettled, revisionParam])

  // ─── 安全 resolver ──────────────────────────────────────────────────────────
  const assetMap = useMemo(
    () => new Map((record?.assets || []).map((asset) => [asset.id, asset.url])),
    [record],
  )

  const resolveQuestion = useMemo(() => {
    return (questionId: string): QuestionResolution => {
      return questionMap[questionId]
        || { status: 'missing' as const, message: `题目不可用（ID: ${questionId || '未设置'}）` }
    }
  }, [questionMap])

  const resolveFigure = useMemo(() => {
    return (asset: FigureAssetRef): FigureResolution => {
      if (asset.type === 'documentAsset') {
        return assetMap.get(asset.assetId) || { status: 'missing' as const }
      }
      if (asset.type === 'legacyPath') {
        return asset.path ? assetUrl(asset.path) : { status: 'missing' as const }
      }
      // questionFigure：经题库题目的 figures 解析，复用与编辑器一致的安全 resolver。
      const question = questionMap[asset.questionId]
      if (!question || ('status' in question && question.status === 'loading')) {
        return { status: 'loading' as const }
      }
      if ('status' in question) {
        return question.status === 'error'
          ? { status: 'error' as const, message: question.message }
          : { status: 'missing' as const, message: question.message }
      }
      const figure = question.figures?.find(
        (item) => String(item.id || item.blockId || '') === asset.figureId,
      )
      return figure?.path ? assetUrl(figure.path) : { status: 'missing' as const }
    }
  }, [assetMap, questionMap])

  // ─── 测量与分页 ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (state !== 'measuring' || !document) return
    const root = measurementRootRef.current
    if (!root) return
    const generation = generationRef.current + 1
    generationRef.current = generation
    const controller = new AbortController()

    void waitForRenderReadiness(root, { timeoutMs: 15_000, stableFrames: 2, signal: controller.signal })
      .then((result: RenderReadinessResult) => {
        if (controller.signal.aborted || generation !== generationRef.current) return
        setReadiness(result)
        const measurement = measureTeachingDocument(root, document)
        const paragraphMeasurements = measureTeachingDocumentParagraphs(root, document)
        const boxMeasurements = measureTeachingDocumentBoxes(root, document, measurement)
        const questionMeasurements = measureTeachingDocumentQuestions(
          root, document, measurement, resolveQuestion,
        )
        const boxChildQuestionMeasurements = measureBoxChildQuestions(
          root, document, measurement, resolveQuestion,
        )
        measurement.diagnostics.push(...result.diagnostics)
        if (controller.signal.aborted || generation !== generationRef.current) return
        const paginationResult = paginateTeachingDocument({
          document,
          measurements: measurement,
          paragraphMeasurements,
          boxMeasurements,
          questionMeasurements,
          boxChildQuestionMeasurements,
          paper,
          metrics,
        })
        setPagination(paginationResult)
        setState('ready')
      })
      .catch((err) => {
        // readiness 等待被拒绝时立即进入 error 态，随后由 notify effect 通知主进程失败，
        // 避免隐藏窗口静默等待主进程 30s 超时。
        if (controller.signal.aborted || generation !== generationRef.current) return
        setError(err instanceof Error ? err.message : '排版资源准备失败')
        setState('error')
      })

    return () => controller.abort()
  }, [state, document, paper, metrics, resolveQuestion])

  // ─── 仅在同一 readiness 通过后 notifyReady ──────────────────────────────────
  useEffect(() => {
    if (notifiedRef.current) return
    if (state === 'error') {
      notifiedRef.current = true
      window.questionWorkbench?.pdfExport?.notifyReady({ error: error || '文档加载失败' })
      return
    }
    if (state === 'ready' && pagination && readiness) {
      // 复用导出 readiness 分类：readiness 未就绪（timedOut/not-ready）或分页存在阻塞诊断时
      // 立即 notifyReady({error})，禁止错误分页导出；仅允许明确的降级 warning。
      const evaluation = evaluateExportReadiness({
        documentRevision: record?.revision ?? revisionParam,
        paginationGeneration: generationRef.current,
        pagination,
        renderReadiness: readiness,
        hasUnsavedChanges: false,
        hasRevisionConflict: revisionMismatch,
        autosaveFailed: false,
        measurementGenerationCurrent: true,
      })
      notifiedRef.current = true
      if (evaluation.ready) {
        window.questionWorkbench?.pdfExport?.notifyReady({
          pageCount: evaluation.pageCount,
          warnings: evaluation.warnings.map((d) => d.message),
        })
      } else {
        const blockingMessage = evaluation.blockingDiagnostics[0]?.message
          || '排版未就绪，禁止导出。'
        window.questionWorkbench?.pdfExport?.notifyReady({ error: blockingMessage })
      }
    }
  }, [state, pagination, readiness, error, record, revisionParam, revisionMismatch])

  const totalPages = pagination?.pages.length || 0

  return (
    <div
      {...{
        [TEACHING_DOM.printDocument]: '',
        [TEACHING_DOM.readinessComplete]: state === 'ready' && Boolean(readiness?.ready) ? 'true' : 'false',
        [TEACHING_DOM.paginationGeneration]: generationRef.current,
        [TEACHING_DOM.exportRevision]: revisionParam,
        [TEACHING_DOM.pageCount]: totalPages,
      }}
    >
      {/* 隐藏测量根：document 存在即挂载，保证 measuring 阶段可测量。 */}
      {document ? (
        <div
          aria-hidden="true"
          data-teaching-measure-root=""
          className="pointer-events-none fixed -left-[100000px] top-0 overflow-visible opacity-0"
          style={{ width: `${metrics.contentWidthPx}px` } as CSSProperties}
        >
          <div ref={measurementRootRef}>
            <TeachingDocumentRenderer
              document={document}
              resolveQuestion={resolveQuestion}
              resolveFigure={resolveFigure}
              eagerImages
              surface="paper"
            />
          </div>
        </div>
      ) : null}

      {state === 'loading' || state === 'measuring' ? (
        <div className="flex h-screen items-center justify-center bg-white text-sm text-zinc-500">
          {state === 'loading' ? '加载文档…' : '测量排版…'}
        </div>
      ) : state === 'error' || !document ? (
        <div className="flex h-screen items-center justify-center bg-white text-sm text-red-600">
          {error || '文档不可用'}
        </div>
      ) : (
        (pagination?.pages || []).map((page) => (
          <PaperPageView
            key={page.index}
            page={page}
            document={document}
            paper={paper}
            printLayout={printLayout}
            totalPages={totalPages}
            resolvers={{ resolveQuestion, resolveFigure }}
          />
        ))
      )}
    </div>
  )
}
