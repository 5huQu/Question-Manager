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
import { lectureFontCssVars, resolveDocumentFonts } from '@/utils/teachingDocument/lectureFonts'
import {
  resolveDocumentPaper,
  isA3LandscapeSpread,
  logicalPagePaper,
  parsePaperSpec,
  measureTeachingDocumentBoxes,
  measureTeachingDocument,
  measureTeachingDocumentParagraphs,
  measureTeachingDocumentQuestions,
  measureBoxChildQuestions,
  paginateTeachingDocument,
  createDocumentPrintLayout,
  effectivePaperMetrics,
  evaluateExportReadiness,
  inspectRenderedPaperOverflow,
  TEACHING_DOM,
  waitForRenderReadiness,
  type PaginationResult,
  type PaperSpec,
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
import { A3TwoColumnSheetView } from '@/components/teaching-document/A3TwoColumnSheetView'
import { assetUrl } from '@/utils/questionDisplay'
import '@/components/teaching-document/teaching-document.css'
import '@/components/teaching-document/print.css'

type PageState = 'loading' | 'error' | 'measuring' | 'ready'

export default function TeachingDocumentPrintPage() {
  const [searchParams] = useSearchParams()
  const docId = searchParams.get('docId') || ''
  const revisionParam = Number(searchParams.get('revision') || '0')
  const autoPrint = searchParams.get('autoPrint') === '1'

  const [state, setState] = useState<PageState>('loading')
  const [error, setError] = useState('')
  const [record, setRecord] = useState<TeachingDocumentRecord | null>(null)
  const [pagination, setPagination] = useState<PaginationResult | null>(null)
  const [readiness, setReadiness] = useState<RenderReadinessResult | null>(null)
  const [questionMap, setQuestionMap] = useState<Record<string, QuestionResolution>>({})

  const measurementRootRef = useRef<HTMLDivElement>(null)
  const printRootRef = useRef<HTMLDivElement>(null)
  const generationRef = useRef(0)
  const notifiedRef = useRef(false)

  const paper = useMemo<PaperSpec>(
    () => resolveDocumentPaper(record?.content?.style),
    [record?.content?.style],
  )
  const pagePaper = useMemo<PaperSpec>(() => logicalPagePaper(paper), [paper])
  const spread = isA3LandscapeSpread(paper)
  // 导出期望纸张：由导出面板经主进程 buildPrintUrl 附加到 URL query，
  // 用于交叉校验“文档纸张”与“printToPDF MediaBox 所用纸张”是否一致。
  const expectedPaper = useMemo<PaperSpec | null>(() => {
    const raw = searchParams.get('paper')
    if (!raw) return null
    try {
      return parsePaperSpec(JSON.parse(raw))
    } catch {
      return null
    }
  }, [searchParams])

  // 纸张尺寸 CSS 变量必须注入到 :root（document.documentElement）：
  // Chromium 只会从根元素解析 @page { size: var(--td-page-size) } 中的自定义属性，
  // 设在普通 div 上会导致 A3/landscape 回退为默认 A4。打印页独占窗口，离开时清理。
  // 注意：本组件下方存在局部变量 document（教学文档内容）会遮蔽全局 document，
  // 因此这里必须显式通过 window.document 访问根元素。
  useEffect(() => {
    const rootStyle = window.document.documentElement.style
    rootStyle.setProperty('--td-page-size', `${paper.widthMm}mm ${paper.heightMm}mm`)
    rootStyle.setProperty('--td-page-width', `${paper.widthMm}mm`)
    rootStyle.setProperty('--td-page-height', `${paper.heightMm}mm`)
    return () => {
      rootStyle.removeProperty('--td-page-size')
      rootStyle.removeProperty('--td-page-width')
      rootStyle.removeProperty('--td-page-height')
    }
  }, [paper])
  const printLayout = useMemo(
    () => createDocumentPrintLayout(pagePaper, record?.content?.style?.print),
    [pagePaper, record?.content?.style?.print],
  )
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
          paper: pagePaper,
          metrics,
          documentHeaderSpanColumns: spread ? 2 : 1,
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
  }, [state, document, pagePaper, metrics, resolveQuestion, spread])

  // ─── 仅在同一 readiness 通过后 notifyReady ──────────────────────────────────
  useEffect(() => {
    if (notifiedRef.current) return
    if (state === 'error') {
      notifiedRef.current = true
      window.questionWorkbench?.pdfExport?.notifyReady({ error: error || '文档加载失败' })
      return
    }
    if (state === 'ready' && pagination && readiness) {
      const renderedOverflowDiagnostics = printRootRef.current
        ? inspectRenderedPaperOverflow(printRootRef.current)
        : []
      const verifiedPagination = renderedOverflowDiagnostics.length
        ? {
            ...pagination,
            diagnostics: [...pagination.diagnostics, ...renderedOverflowDiagnostics],
          }
        : pagination
      // 复用导出 readiness 分类：readiness 未就绪（timedOut/not-ready）或分页存在阻塞诊断时
      // 立即 notifyReady({error})，禁止错误分页导出；仅允许明确的降级 warning。
      const evaluation = evaluateExportReadiness({
        documentRevision: record?.revision ?? revisionParam,
        paginationGeneration: generationRef.current,
        pagination: verifiedPagination,
        renderReadiness: readiness,
        hasUnsavedChanges: false,
        hasRevisionConflict: revisionMismatch,
        autosaveFailed: false,
        measurementGenerationCurrent: true,
        paper,
        expectedPaper,
      })
      notifiedRef.current = true
      if (evaluation.ready) {
        window.questionWorkbench?.pdfExport?.notifyReady({
          pageCount: spread ? Math.ceil(evaluation.pageCount / 2) : evaluation.pageCount,
          warnings: evaluation.warnings.map((d) => d.message),
        })
      } else {
        const blockingMessage = evaluation.blockingDiagnostics[0]?.message
          || '排版未就绪，禁止导出。'
        window.questionWorkbench?.pdfExport?.notifyReady({ error: blockingMessage })
      }
    }
  }, [state, pagination, readiness, error, record, revisionParam, revisionMismatch, paper, expectedPaper, spread])

  useEffect(() => {
    if (!autoPrint || state !== 'ready' || !pagination || !readiness?.ready) return
    const timer = window.setTimeout(() => window.print(), 150)
    return () => window.clearTimeout(timer)
  }, [autoPrint, state, pagination, readiness])

  const totalPages = pagination?.pages.length || 0
  const sheetCount = spread ? Math.ceil(totalPages / 2) : totalPages

  const documentFonts = useMemo(() => resolveDocumentFonts(document?.style), [document?.style])
  const fontVars = useMemo(
    () => lectureFontCssVars(documentFonts.body, documentFonts.heading),
    [documentFonts],
  )

  return (
    <div
      ref={printRootRef}
      className="td-theme-print"
      style={{
        ...fontVars,
      } as CSSProperties}
      {...{
        [TEACHING_DOM.printDocument]: '',
        [TEACHING_DOM.readinessComplete]: state === 'ready' && Boolean(readiness?.ready) ? 'true' : 'false',
        [TEACHING_DOM.paginationGeneration]: generationRef.current,
        [TEACHING_DOM.exportRevision]: revisionParam,
        [TEACHING_DOM.pageCount]: sheetCount,
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
        spread ? Array.from({ length: sheetCount }, (_, sheetIndex) => {
          const leftPage = pagination!.pages[sheetIndex * 2]
          const rightPage = pagination!.pages[sheetIndex * 2 + 1]
          return (
            <A3TwoColumnSheetView
              key={`sheet:${sheetIndex}`}
              pages={[leftPage, rightPage]}
              sheetIndex={sheetIndex}
              sheetCount={sheetCount}
              logicalPageCount={totalPages}
              document={document}
              sheetPaper={paper}
              columnPaper={pagePaper}
              printLayout={printLayout}
              pageProps={{ resolvers: { resolveQuestion, resolveFigure } }}
            />
          )
        }) : (pagination?.pages || []).map((page) => (
          <PaperPageView
            key={page.index}
            page={page}
            document={document}
            paper={pagePaper}
            printLayout={printLayout}
            totalPages={totalPages}
            resolvers={{ resolveQuestion, resolveFigure }}
          />
        ))
      )}
    </div>
  )
}
