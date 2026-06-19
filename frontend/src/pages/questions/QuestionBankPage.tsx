import { useMemo, useState } from 'react'
import { api } from '@/api/client'
import { BankTab } from '@/components/questions/WorkbenchQuestionCard'
import { useAsync } from '@/hooks/useAsync'
import type { QuestionBankResponse, QuestionItem } from '@/types'

export function QuestionBankPage() {
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState('')
  const [questionType, setQuestionType] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [knowledgePoint, setKnowledgePoint] = useState('')
  const [solutionMethod, setSolutionMethod] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 20
  const questionBankUrl = useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    if (query.trim()) params.set('q', query.trim())
    if (stage) params.set('stage', stage)
    if (questionType) params.set('questionType', questionType)
    if (difficulty) params.set('difficulty', difficulty)
    if (knowledgePoint) params.set('knowledgePoint', knowledgePoint)
    if (solutionMethod) params.set('solutionMethod', solutionMethod)
    return `/api/question-bank/items?${params.toString()}`
  }, [difficulty, knowledgePoint, page, query, questionType, solutionMethod, stage])
  const questionBank = useAsync<QuestionBankResponse>(() => api(questionBankUrl), [questionBankUrl])
  function replaceQuestionInBank(item: QuestionItem) {
    questionBank.setData((current) => current ? {
      ...current,
      items: current.items.map((entry) => entry.id === item.id ? item : entry),
    } : current)
  }
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between border-b pb-3 shrink-0 border-zinc-200 dark:border-zinc-800">
        <div>
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">系统功能 / 题库</p>
          <h2 className="text-base font-bold mt-0.5 text-zinc-900 dark:text-zinc-50">主库题目检索与详情管理</h2>
        </div>
      </div>
      <BankTab
        questionBank={questionBank.data}
        reload={questionBank.reload}
        loading={questionBank.loading}
        error={questionBank.error}
        query={query}
        setQuery={setQuery}
        stage={stage}
        setStage={setStage}
        questionType={questionType}
        setQuestionType={setQuestionType}
        difficulty={difficulty}
        setDifficulty={setDifficulty}
        knowledgePoint={knowledgePoint}
        setKnowledgePoint={setKnowledgePoint}
        solutionMethod={solutionMethod}
        setSolutionMethod={setSolutionMethod}
        page={page}
        setPage={setPage}
        onQuestionSaved={replaceQuestionInBank}
      />
    </section>
  )
}


export default QuestionBankPage
