import {
  Eye,
  EyeOff,
  ShoppingBag,
  Save,
  LoaderCircle,
  Copy,
  RotateCcw,
  ChevronLeft,
  AlertTriangle,
  FileCode2,
  FileText,
  FileDown,
} from 'lucide-react'
import { Badge } from '../../ui'
import { QuestionMarkdownContent } from '../../questions/QuestionContent'
import { stripLeadingQuestionNo } from '../../QuestionBasket'
import { difficultyText, difficultyOptions } from './constants'
import type { QuickActionState } from './useQuickAction'

export function DailyResultView({ state }: { state: QuickActionState }) {
  const { dailyResult, showDailyAnswer } = state
  if (!dailyResult) return null

  return (
    <div className="space-y-6 text-left">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success">匹配题型: {dailyResult.question.questionType}</Badge>
          <Badge variant="outline">{dailyResult.question.stage || '未设学段'}</Badge>
          <Badge variant="outline">{difficultyText(dailyResult.question)}</Badge>
        </div>
        <span className="text-[11px] text-zinc-400 font-mono">ID: #{dailyResult.question.id}</span>
      </div>

      <article className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50">
        <QuestionMarkdownContent
          className="text-[15px] leading-7"
          content={dailyResult.markdown}
          figures={dailyResult.question.figures}
        />
      </article>

      {showDailyAnswer && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-6 space-y-4 dark:border-zinc-800 dark:bg-zinc-900/20 animate-in slide-in-from-top-2 duration-300">
          <div>
            <h4 className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">参考答案</h4>
            <div className="mt-2 text-sm">
              <QuestionMarkdownContent content={dailyResult.question.answerText || '暂无答案'} />
            </div>
          </div>
          <div className="border-t border-zinc-200 dark:border-zinc-800 pt-4">
            <h4 className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">详细解析</h4>
            <div className="mt-2 text-sm">
              <QuestionMarkdownContent
                content={dailyResult.question.analysisMarkdown || '暂无解析'}
                figures={dailyResult.question.figures.filter((f: any) => f.usage === 'analysis')}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function RandomPaperResultView({ state }: { state: QuickActionState }) {
  const {
    randomResult,
    showGlobalRandomAnswers,
    localRandomAnswersVisible,
    setLocalRandomAnswersVisible,
  } = state
  if (!randomResult) return null

  return (
    <div className="space-y-6 text-left pb-12">
      {randomResult.summary && (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-xs shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400">题量</span>
              <span className="mt-1 block font-mono font-bold text-zinc-900 dark:text-zinc-100">
                {randomResult.summary.generatedTotal}/{randomResult.summary.requestedTotal}
              </span>
            </div>
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400">平均难度</span>
              <span className="mt-1 block font-mono font-bold text-zinc-900 dark:text-zinc-100">
                {randomResult.summary.averageDifficulty ? `${randomResult.summary.averageDifficulty}/10` : '待定'}
              </span>
            </div>
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400">匹配方式</span>
              <span className="mt-1 block font-semibold text-zinc-900 dark:text-zinc-100">
                {randomResult.summary.matchMode === 'strict' ? '精准匹配' : '宽松匹配'}
              </span>
            </div>
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400">难度模式</span>
              <span className="mt-1 block font-semibold text-zinc-900 dark:text-zinc-100">
                {difficultyOptions.find((item) => item.value === randomResult.summary!.difficultyMode)?.label || '常规练习'}
              </span>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            {Object.entries(randomResult.summary.typeCounts).map(([type, count]) => (
              <Badge key={type} variant="outline">{type} {count}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* Warnings (Shortage banners) */}
      {randomResult.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/55 p-4 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/10 dark:text-amber-400 space-y-1">
          <h4 className="font-semibold flex items-center gap-1.5">
            <AlertTriangle className="size-3.5" />
            匹配提示
          </h4>
          <ul className="list-disc pl-4 space-y-0.5 mt-1 font-medium">
            {randomResult.warnings.map((warn, i) => (
              <li key={i}>{warn}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-4">
        {randomResult.questions.map((question, index) => {
          const showAnswer =
            showGlobalRandomAnswers || localRandomAnswersVisible[question.id]
          return (
            <div
              key={question.id}
              className="border border-zinc-200 bg-white rounded-xl p-5 dark:border-zinc-800 dark:bg-zinc-900/30 flex items-start gap-4 hover:border-zinc-300 hover:shadow-sm transition-all duration-300"
            >
              <div className="flex flex-col items-center gap-1.5 shrink-0">
                <span className="flex size-6 items-center justify-center rounded bg-zinc-900 text-xs font-mono font-bold text-white dark:bg-zinc-100 dark:text-zinc-950">
                  {index + 1}
                </span>
              </div>

              <div className="flex-1 min-w-0 space-y-3">
                {/* Metadata row */}
                <div className="flex items-center justify-between text-[11px] text-zinc-400 dark:text-zinc-500 font-mono">
                  <span>
                    {question.questionType} · {question.stage || '未设学段'} · {question.chapter || '未分类'} ·{' '}
                    {difficultyText(question)}
                  </span>
                  <span>ID: #{question.id}</span>
                </div>

                {/* Question Stem */}
                <div className="text-sm text-zinc-900 dark:text-zinc-100 leading-relaxed font-sans">
                  <QuestionMarkdownContent
                    content={stripLeadingQuestionNo(question.stemMarkdown || '', question.questionNo || '')}
                    figures={question.figures}
                  />
                </div>

                {/* Action Bar (Per-question answer toggle) */}
                <div className="flex items-center justify-between pt-2.5 border-t border-zinc-100 dark:border-zinc-800">
                  <button
                    onClick={() =>
                      setLocalRandomAnswersVisible(prev => ({
                        ...prev,
                        [question.id]: !prev[question.id]
                      }))
                    }
                    className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 font-semibold cursor-pointer"
                  >
                    {showAnswer ? (
                      <>
                        <EyeOff className="size-3" />
                        收起答案解析
                      </>
                    ) : (
                      <>
                        <Eye className="size-3" />
                        展开答案解析
                      </>
                    )}
                  </button>
                </div>

                {/* Answer and Analysis Preview */}
                {showAnswer && (
                  <div className="mt-3 rounded-lg bg-zinc-50/50 p-4 border border-zinc-100 dark:bg-zinc-900/10 dark:border-zinc-800 space-y-3 text-xs animate-in slide-in-from-top-1 duration-200">
                    <div>
                      <span className="font-bold text-zinc-400 dark:text-zinc-505 block mb-0.5">参考答案</span>
                      <QuestionMarkdownContent content={question.answerText || '暂无答案'} />
                    </div>
                    <div className="border-t border-zinc-100 dark:border-zinc-800 pt-2">
                      <span className="font-bold text-zinc-400 dark:text-zinc-505 block mb-0.5">详细解析</span>
                      <QuestionMarkdownContent
                        content={question.analysisMarkdown || '暂无解析'}
                        figures={question.figures.filter((f: any) => f.usage === 'analysis')}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ResultControlPanel({ state }: { state: QuickActionState }) {
  const {
    dailyResult,
    randomResult,
    showDailyAnswer,
    setShowDailyAnswer,
    showGlobalRandomAnswers,
    setShowGlobalRandomAnswers,
    handleCopyMarkdown,
    handleAddToBasket,
    handleSaveAsPaper,
    handleExportPaper,
    handleGenerate,
    handleReset,
    basketSuccess,
    exportFormat,
    setExportFormat,
    exportVariant,
    setExportVariant,
    isExporting,
    paperTitle,
    setPaperTitle,
    isSavingPaper,
    saveSuccess,
  } = state

  return (
    <div className="w-full lg:w-[320px] shrink-0 p-5 flex flex-col justify-between overflow-y-auto bg-white dark:bg-zinc-955 text-left select-none">
      <div className="space-y-5">
        <div className="flex items-center justify-between border-b border-zinc-100 pb-3 dark:border-zinc-800">
          <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-600 uppercase tracking-wider">
            操作与输出控制
          </span>
          <span className="text-[10px] font-mono text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded">
            控制面板
          </span>
        </div>

        {/* Answer Visibility Toggle */}
        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600 block">
            参考答案显隐
          </label>
          <button
            type="button"
            onClick={() => {
              if (dailyResult) setShowDailyAnswer(!showDailyAnswer)
              else setShowGlobalRandomAnswers(!showGlobalRandomAnswers)
            }}
            className={`flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold shadow-sm transition-all cursor-pointer ${
              (dailyResult ? showDailyAnswer : showGlobalRandomAnswers)
                ? 'bg-zinc-950 border-zinc-950 text-white dark:bg-zinc-50 dark:border-zinc-50 dark:text-zinc-950 font-bold'
                : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800/80'
            }`}
          >
            {(dailyResult ? showDailyAnswer : showGlobalRandomAnswers) ? (
              <>
                <EyeOff className="size-4" />
                隐藏答案及解析
              </>
            ) : (
              <>
                <Eye className="size-4" />
                显示答案及解析
              </>
            )}
          </button>
        </div>

        {/* Actions for Daily Question */}
        {dailyResult && (
          <div className="space-y-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600 block">
              Markdown 导出
            </label>
            <button
              onClick={() =>
                handleCopyMarkdown(
                  `${dailyResult.markdown}\n\n${
                    showDailyAnswer ? dailyResult.answerMarkdown : ''
                  }`
                )
              }
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer transition-all"
            >
              <Copy className="size-3.5" />
              复制 Markdown 源码
            </button>
          </div>
        )}

        {/* Actions for Random Paper */}
        {randomResult && (
          <div className="space-y-4 pt-3 border-t border-zinc-100 dark:border-zinc-800">
            {/* Save to basket */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600 block mb-1.5">
                快速备课
              </label>
              <button
                onClick={handleAddToBasket}
                className={`inline-flex w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-all cursor-pointer ${
                  basketSuccess
                    ? 'bg-emerald-600 border-emerald-600 text-white dark:bg-emerald-500 font-bold'
                    : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'
                }`}
              >
                <ShoppingBag className="size-3.5" />
                {basketSuccess ? '已成功添加至试题篮！' : '添加所有至当前试题篮'}
              </button>
            </div>

            {/* Export Paper Section */}
            <div className="space-y-2.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600 block">
                备选导出（Markdown / PDF）
              </label>
              
              {/* Format Selection */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setExportFormat('Markdown')}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                    exportFormat === 'Markdown'
                      ? 'bg-zinc-950 border-zinc-950 text-white dark:bg-zinc-50 dark:border-zinc-50 dark:text-zinc-950 font-bold'
                      : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800/80'
                  }`}
                >
                  <FileCode2 className="size-3.5" />
                  Markdown
                </button>
                <button
                  type="button"
                  onClick={() => setExportFormat('PDF')}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                    exportFormat === 'PDF'
                      ? 'bg-zinc-950 border-zinc-950 text-white dark:bg-zinc-50 dark:border-zinc-50 dark:text-zinc-950 font-bold'
                      : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800/80'
                  }`}
                >
                  <FileText className="size-3.5" />
                  PDF
                </button>
              </div>

              {/* Variant Selection */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setExportVariant('student')}
                  className={`flex-1 rounded-lg border py-1.5 text-[11px] font-semibold transition-all cursor-pointer ${
                    exportVariant === 'student'
                      ? 'bg-zinc-950 border-zinc-950 text-white dark:bg-zinc-50 dark:border-zinc-50 dark:text-zinc-950 font-bold'
                      : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800/80'
                  }`}
                >
                  {'学生版 (无答案)'}
                </button>
                <button
                  type="button"
                  onClick={() => setExportVariant('teacher')}
                  className={`flex-1 rounded-lg border py-1.5 text-[11px] font-semibold transition-all cursor-pointer ${
                    exportVariant === 'teacher'
                      ? 'bg-zinc-950 border-zinc-950 text-white dark:bg-zinc-50 dark:border-zinc-50 dark:text-zinc-950 font-bold'
                      : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800/80'
                  }`}
                >
                  {'教师版 (含答案)'}
                </button>
              </div>

              <button
                disabled={isExporting}
                onClick={handleExportPaper}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-xs font-semibold text-zinc-700 transition-all hover:bg-zinc-50 disabled:opacity-50 cursor-pointer dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {isExporting ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <FileDown className="size-3.5" />
                )}
                {isExporting ? '正在生成并导出...' : '导出文件'}
              </button>
            </div>

            {/* Save as new collection */}
            <div className="space-y-2.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600 block">
                {'保存组卷快照'}
              </label>
              <input
                type="text"
                value={paperTitle}
                onChange={e => setPaperTitle(e.target.value)}
                placeholder="请输入快照名称..."
                className="w-full text-xs rounded-lg border border-zinc-200 bg-transparent px-3 py-2 outline-none focus:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-900"
              />
              <button
                disabled={isSavingPaper || saveSuccess}
                onClick={handleSaveAsPaper}
                className={`inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-semibold transition-all cursor-pointer ${
                  saveSuccess
                    ? 'bg-emerald-600 border border-emerald-600 text-white font-bold'
                    : 'border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'
                }`}
              >
                {isSavingPaper ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                {saveSuccess ? '已成功保存组卷快照！' : '保存组卷快照'}
              </button>
            </div>
          </div>
        )}

        {/* Regenerate or change settings */}
        <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex gap-2">
          <button
            onClick={handleGenerate}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <RotateCcw className="size-3.5" />
            重新生成
          </button>
          <button
            onClick={handleReset}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 text-xs font-semibold py-2 cursor-pointer shadow-sm"
          >
            <ChevronLeft className="size-3.5" />
            返回修改
          </button>
        </div>
      </div>
    </div>
  )
}
