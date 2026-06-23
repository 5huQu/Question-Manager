import { useMemo, useState } from 'react'
import { questionBankApi } from '@/api/questionBank'
import { BankTab } from '@/components/questions/WorkbenchQuestionCard'
import { useAsync } from '@/hooks/useAsync'
import type { QuestionBankResponse, QuestionItem } from '@/types'

export function QuestionBankPage() {
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState('')
  const [questionType, setQuestionType] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [knowledgePoint, setKnowledgePoint] = useState<string[]>([])
  const [solutionMethod, setSolutionMethod] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const pageSize = 20
  const questionBankParams = useMemo(() => ({
    page,
    pageSize,
    q: query.trim() || undefined,
    stage: stage || undefined,
    questionType: questionType || undefined,
    difficulty: difficulty || undefined,
    knowledgePoint: knowledgePoint.join(',') || undefined,
    solutionMethod: solutionMethod.join(',') || undefined,
  }), [difficulty, knowledgePoint, page, query, questionType, solutionMethod, stage])
  const questionBank = useAsync<QuestionBankResponse>(() => questionBankApi.listItems(questionBankParams), [questionBankParams])
  function replaceQuestionInBank(item: QuestionItem) {
    questionBank.setData((current) => current ? {
      ...current,
      items: current.items.map((entry) => entry.id === item.id ? item : entry),
    } : current)
  }
  return (
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
  )
}


export default QuestionBankPage
