/**
 * 开发实验页：TeachingDocument 渲染与真实题库只读验证
 * 路由：/mock/teaching-document（仅 DEV 环境）
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, Database, LoaderCircle, Moon, Sun } from 'lucide-react'
import wideFixtureUrl from '@/assets/teaching-document/quadratic-tangent.png'
import tallFixtureUrl from '@/assets/teaching-document/geometry-tall.png'
import { questionBankApi } from '@/api/questionBank'
import { A4PaginationPreview } from '@/components/teaching-document/A4PaginationPreview'
import { TeachingDocumentRenderer } from '@/components/teaching-document/TeachingDocumentRenderer'
import type { QuestionResolution } from '@/components/teaching-document/blocks/BlockRenderer'
import {
  TEACHING_DOCUMENT_ABNORMAL_INPUT,
  TEACHING_DOCUMENT_ASSET_IDS,
  TEACHING_DOCUMENT_NORMAL_FIXTURE,
  TEACHING_DOCUMENT_QUESTION_FIXTURES,
} from '@/fixtures/teachingDocumentFixtures'
import {
  TEACHING_DOCUMENT_PARAGRAPH_PAGINATION_ABNORMAL_FIXTURE,
  TEACHING_DOCUMENT_PARAGRAPH_PAGINATION_BOUNDARY_FIXTURE,
  TEACHING_DOCUMENT_PARAGRAPH_PAGINATION_NORMAL_FIXTURE,
  TEACHING_DOCUMENT_BOX_PAGINATION_ABNORMAL_FIXTURE,
  TEACHING_DOCUMENT_BOX_PAGINATION_NORMAL_FIXTURE,
  TEACHING_DOCUMENT_QUESTION_PAGINATION_ABNORMAL_FIXTURE,
  TEACHING_DOCUMENT_QUESTION_PAGINATION_BOUNDARY_FIXTURE,
  TEACHING_DOCUMENT_QUESTION_PAGINATION_NORMAL_FIXTURE,
} from '@/fixtures/teachingDocumentPaginationFixtures'
import type { QuestionItem } from '@/types'
import type { FigureAssetRef, QuestionBlock, TeachingDocumentV1 } from '@/types/teachingDocument'
import { assetUrl } from '@/utils/questionDisplay'
import {
  A4_MARGIN_PRESETS,
  parseTeachingDocument,
  validateTeachingDocument,
  type PaperSpec,
} from '@/utils/teachingDocument'
import '@/components/teaching-document/teaching-document.css'

type RealQuestionState =
  | { status: 'idle'; id: '' }
  | { status: 'loading'; id: string }
  | { status: 'ready'; id: string; question: QuestionItem }
  | { status: 'error'; id: string; message: string }

type FixtureKind =
  | 'normal'
  | 'abnormal'
  | 'paragraph-normal'
  | 'paragraph-boundary'
  | 'paragraph-abnormal'
  | 'box-normal'
  | 'box-abnormal'
  | 'question-normal'
  | 'question-boundary'
  | 'question-abnormal'

const FIXTURE_OPTIONS: Array<{ kind: FixtureKind; label: string }> = [
  { kind: 'normal', label: '渲染正常' },
  { kind: 'abnormal', label: '渲染异常' },
  { kind: 'paragraph-normal', label: '段落正常' },
  { kind: 'paragraph-boundary', label: '段落边界' },
  { kind: 'paragraph-abnormal', label: '段落异常' },
  { kind: 'box-normal', label: '盒子正常' },
  { kind: 'box-abnormal', label: '盒子异常' },
  { kind: 'question-normal', label: '题目正常' },
  { kind: 'question-boundary', label: '题目边界' },
  { kind: 'question-abnormal', label: '题目异常' },
]

export default function TeachingDocumentMockPage() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const [fixtureKind, setFixtureKind] = useState<FixtureKind>('normal')
  const [canvasMode, setCanvasMode] = useState<'continuous' | 'a4'>('continuous')
  const [paper, setPaper] = useState<PaperSpec>(A4_MARGIN_PRESETS.normal)
  const [paperZoom, setPaperZoom] = useState(0.75)
  const [questionIdInput, setQuestionIdInput] = useState(() => new URLSearchParams(window.location.search).get('questionId') || '')
  const [realQuestion, setRealQuestion] = useState<RealQuestionState>({ status: 'idle', id: '' })

  const abnormal = useMemo(() => parseTeachingDocument(TEACHING_DOCUMENT_ABNORMAL_INPUT), [])
  const baseDocument = {
    normal: TEACHING_DOCUMENT_NORMAL_FIXTURE,
    abnormal: abnormal.document,
    'paragraph-normal': TEACHING_DOCUMENT_PARAGRAPH_PAGINATION_NORMAL_FIXTURE,
    'paragraph-boundary': TEACHING_DOCUMENT_PARAGRAPH_PAGINATION_BOUNDARY_FIXTURE,
    'paragraph-abnormal': TEACHING_DOCUMENT_PARAGRAPH_PAGINATION_ABNORMAL_FIXTURE,
    'box-normal': TEACHING_DOCUMENT_BOX_PAGINATION_NORMAL_FIXTURE,
    'box-abnormal': TEACHING_DOCUMENT_BOX_PAGINATION_ABNORMAL_FIXTURE,
    'question-normal': TEACHING_DOCUMENT_QUESTION_PAGINATION_NORMAL_FIXTURE,
    'question-boundary': TEACHING_DOCUMENT_QUESTION_PAGINATION_BOUNDARY_FIXTURE,
    'question-abnormal': TEACHING_DOCUMENT_QUESTION_PAGINATION_ABNORMAL_FIXTURE,
  }[fixtureKind]
  const renderedDocument = useMemo(() => appendRealQuestion(baseDocument, realQuestion), [baseDocument, realQuestion])
  const validation = useMemo(() => renderedDocument ? validateTeachingDocument(renderedDocument) : null, [renderedDocument])

  const questionResolver = useMemo(() => {
    return (questionId: string): QuestionResolution => {
      const fixture = TEACHING_DOCUMENT_QUESTION_FIXTURES[questionId]
      if (fixture) {
        return {
          ...fixture,
          figures: fixture.figures.map((figure) => ({
            ...figure,
            path: figure.path === '__teaching_fixture_wide__'
              ? new URL(wideFixtureUrl, window.location.origin).href
              : figure.path === '__teaching_fixture_tall__'
                ? new URL(tallFixtureUrl, window.location.origin).href
                : figure.path,
          })),
        }
      }
      if (realQuestion.id !== questionId) {
        return { status: 'missing', message: `题目不存在（ID: ${questionId || '未设置'}）` }
      }
      if (realQuestion.status === 'loading') return { status: 'loading' }
      if (realQuestion.status === 'error') return { status: 'error', message: realQuestion.message }
      if (realQuestion.status === 'ready') return realQuestion.question
      return { status: 'missing' }
    }
  }, [realQuestion])

  const figureResolver = useMemo(() => {
    const documentAssets: Record<string, string> = {
      [TEACHING_DOCUMENT_ASSET_IDS.wide]: wideFixtureUrl,
      [TEACHING_DOCUMENT_ASSET_IDS.tall]: tallFixtureUrl,
      [TEACHING_DOCUMENT_ASSET_IDS.broken]: '/assets/teaching-document-intentionally-missing.png',
    }
    return (asset: FigureAssetRef): string => {
      if (asset.type === 'documentAsset') return documentAssets[asset.assetId] || ''
      if (asset.type === 'legacyPath') {
        if (/^(?:[a-zA-Z]:[\\/]|\/|file:\/\/)/.test(asset.path.trim())) return ''
        return asset.path.trim() ? assetUrl(asset.path) : ''
      }
      const question = realQuestion.status === 'ready' && realQuestion.question.id === asset.questionId
        ? realQuestion.question
        : TEACHING_DOCUMENT_QUESTION_FIXTURES[asset.questionId]
      const figure = question?.figures?.find((item) => String(item.id || item.blockId || '') === asset.figureId)
      return figure?.path ? assetUrl(figure.path) : ''
    }
  }, [realQuestion])

  async function loadRealQuestion() {
    const id = questionIdInput.trim()
    if (!id) {
      setRealQuestion({ status: 'idle', id: '' })
      return
    }
    setRealQuestion({ status: 'loading', id })
    try {
      const question = await questionBankApi.getItem(id)
      setRealQuestion({ status: 'ready', id, question })
    } catch (error) {
      setRealQuestion({
        status: 'error',
        id,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  function toggleDark() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
  }

  if (!renderedDocument) {
    return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">异常 fixture 无法解析。</div>
  }

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-6 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">开发实验 · 只读</p>
              <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">TeachingDocument 渲染器验收</h1>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-zinc-200 bg-zinc-100/80 p-0.5 dark:border-zinc-700 dark:bg-zinc-800">
                {FIXTURE_OPTIONS.map(({ kind, label }) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setFixtureKind(kind)}
                    className={`rounded-md px-3 py-1 text-xs font-medium ${
                      fixtureKind === kind
                        ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50'
                        : 'text-zinc-500'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={toggleDark}
                className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
                {dark ? '浅色' : '深色'}
              </button>
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <label className="flex min-w-0 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-950">
              <Database className="size-4 shrink-0 text-zinc-400" />
              <span className="shrink-0 text-xs text-zinc-500">真实题目 ID</span>
              <input
                value={questionIdInput}
                onChange={(event) => setQuestionIdInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void loadRealQuestion()
                }}
                className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
                placeholder="可选；只读调用 questionBankApi.getItem"
              />
            </label>
            <button
              type="button"
              onClick={() => void loadRealQuestion()}
              disabled={realQuestion.status === 'loading'}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
            >
              {realQuestion.status === 'loading' ? <LoaderCircle className="size-4 animate-spin" /> : null}
              加载真实题目
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
            <span>解析 issue：{fixtureKind === 'abnormal' ? abnormal.issues.length : 0}</span>
            <span>验证 issue：{validation?.issues.length || 0}</span>
            <span className={validation?.valid ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
              {validation?.valid ? '结构有效' : '包含预期异常'}
            </span>
            {realQuestion.status === 'ready' ? (
              <span>真实题图：{realQuestion.question.figures?.length || 0} 张</span>
            ) : null}
            {realQuestion.status === 'error' ? (
              <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400">
                <AlertTriangle className="size-3" />
                {realQuestion.message}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <div className="flex rounded-lg border border-zinc-200 bg-zinc-100/80 p-0.5 dark:border-zinc-700 dark:bg-zinc-800">
              <button type="button" onClick={() => setCanvasMode('continuous')} className={`rounded-md px-3 py-1 font-medium ${canvasMode === 'continuous' ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50' : 'text-zinc-500'}`}>连续画布</button>
              <button type="button" onClick={() => setCanvasMode('a4')} className={`rounded-md px-3 py-1 font-medium ${canvasMode === 'a4' ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50' : 'text-zinc-500'}`}>A4 分页</button>
            </div>
            {canvasMode === 'a4' ? (
              <>
                <label className="text-zinc-500">页边距
                  <select
                    aria-label="页边距"
                    className="ml-1 h-7 rounded border border-zinc-200 bg-white px-1 dark:border-zinc-700 dark:bg-zinc-950"
                    value={Object.entries(A4_MARGIN_PRESETS).find(([, value]) => value.marginTopMm === paper.marginTopMm && value.marginLeftMm === paper.marginLeftMm)?.[0] || 'normal'}
                    onChange={(event) => setPaper(A4_MARGIN_PRESETS[event.target.value as keyof typeof A4_MARGIN_PRESETS])}
                  >
                    <option value="compact">紧凑</option>
                    <option value="normal">标准</option>
                    <option value="relaxed">宽松</option>
                  </select>
                </label>
                <label className="text-zinc-500">缩放 {Math.round(paperZoom * 100)}%
                  <input aria-label="预览缩放" className="ml-1 w-24 align-middle" type="range" min={45} max={110} step={5} value={paperZoom * 100} onChange={(event) => setPaperZoom(Number(event.target.value) / 100)} />
                </label>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="bg-white p-4 dark:bg-zinc-900">
        {canvasMode === 'a4' ? (
          <A4PaginationPreview
            document={renderedDocument}
            resolveQuestion={questionResolver}
            resolveFigure={figureResolver}
            paper={paper}
            zoom={paperZoom}
          />
        ) : (
          <TeachingDocumentRenderer
            document={renderedDocument}
            resolveQuestion={questionResolver}
            resolveFigure={figureResolver}
          />
        )}
      </div>
    </main>
  )
}

function appendRealQuestion(document: TeachingDocumentV1 | null, state: RealQuestionState): TeachingDocumentV1 | null {
  if (!document || state.status === 'idle') return document
  const questionBlock: QuestionBlock = {
    type: 'question',
    id: 'dev-real-question-preview',
    questionId: state.id,
    display: {
      showAnswer: true,
      showAnalysis: true,
      displayNumber: '真实题',
    },
  }
  const content: TeachingDocumentV1['content'] = [
    ...document.content,
    { type: 'divider', id: 'dev-real-question-divider' },
    { type: 'heading', id: 'dev-real-question-heading', level: 1, content: [{ type: 'text', text: '四、真实题库只读预览' }] },
    questionBlock,
  ]
  if (state.status === 'ready') {
    const figure = state.question.figures?.find((item) => item.path && (item.id || item.blockId))
    const figureId = String(figure?.id || figure?.blockId || '')
    if (figure && figureId) {
      content.push({
        type: 'figure',
        id: 'dev-real-question-figure',
        asset: {
          type: 'questionFigure',
          questionId: state.question.id,
          figureId,
        },
        alignment: 'center',
        widthRatio: 0.65,
        alt: '来自题库 figure 资源链路的图片',
        caption: `题库题图 · ${figureId}`,
      })
    }
  }
  return { ...document, content }
}
