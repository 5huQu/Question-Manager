import { describe, expect, it } from 'vitest'
import { buildCandidateReviewModel } from './candidateReviewModel'
import type { UnifiedQuestion } from './importV2PageModel'

function question(overrides: Partial<UnifiedQuestion>): UnifiedQuestion {
  return {
    id: 'candidate-1', questionNo: '1', questionType: '单选题', stemMarkdown: '题干', answerText: 'A',
    analysisMarkdown: '', status: 'ready', issues: [], figures: [], hasFigures: false, parseDiagnostics: [],
    rawItem: {} as UnifiedQuestion['rawItem'], ...overrides,
  }
}

describe('candidate review model', () => {
  it('keeps filtering, diagnostics and selectable candidates in one model', () => {
    const questions = [
      question({ id: 'ready' }),
      question({ id: 'warning', issues: [{ severity: 'warning', message: '核对', code: 'missing_analysis' }], parseDiagnostics: [{ code: 'missing_analysis', severity: 'warning', message: '缺少解析' }] }),
      question({ id: 'blocked', status: 'blocked', issues: [{ severity: 'error', message: '修正' }] }),
    ]
    const model = buildCandidateReviewModel({ questions, activeQuestionId: 'warning', activeTab: 'warning', activeDiagnosticCode: '', committedIds: new Set(['ready']) })
    expect(model.filteredQuestions.map((item) => item.id)).toEqual(['warning'])
    expect(model.visibleActiveParseDiagnostics).toEqual([])
    expect(model.parseDiagnosticCounts).toEqual([{ code: 'missing_analysis', count: 1, severity: 'warning' }])
    expect(model.selectableList.map((item) => item.id)).toEqual(['warning'])
    expect(model.committedQuestionCount).toBe(1)
  })
})
