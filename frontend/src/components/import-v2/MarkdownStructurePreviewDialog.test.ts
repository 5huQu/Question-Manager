import { describe, expect, it } from 'vitest'
import { textareaAnchorFromScrollTop, textareaScrollTopForAnchor } from './MarkdownStructurePreviewDialog'
import { lineBelongsToQuestion, questionNoForLine, questionStartLine } from './MarkdownStructureViewer'

describe('MarkdownStructurePreviewDialog scroll anchors', () => {
  it('keeps the same visible line and within-line offset across editor remounts', () => {
    const anchor = textareaAnchorFromScrollTop(733)
    expect(anchor).toEqual({ lineNo: 37, lineProgress: 0.65 })
    expect(textareaScrollTopForAnchor(anchor)).toBe(733)
  })

  it('clamps the first line to the top of the editor', () => {
    expect(textareaAnchorFromScrollTop(-20)).toEqual({ lineNo: 1, lineProgress: 0 })
    expect(textareaScrollTopForAnchor({ lineNo: 0, lineProgress: 0 })).toBe(0)
  })
})

describe('MarkdownStructureViewer current question', () => {
  it('uses the containing question range and falls back to the nearest preceding question marker', () => {
    const tokens = [
      { id: 'q4', kind: 'question_no', questionNo: '4', lineStart: 40, lineEnd: 40 },
      { id: 'q4-stem', kind: 'stem_range', questionNo: '4', lineStart: 40, lineEnd: 48 },
      { id: 'q5', kind: 'question_no', questionNo: '5', lineStart: 55, lineEnd: 55 },
      { id: 'q5-analysis', kind: 'analysis_range', questionNo: '5', lineStart: 60, lineEnd: 70 },
    ] as any
    expect(questionNoForLine(tokens, 46)).toBe('4')
    expect(questionNoForLine(tokens, 63)).toBe('5')
    expect(questionNoForLine(tokens, 72)).toBe('5')
  })

  it('highlights untagged code lines between the current and next question markers', () => {
    const tokens = [
      { id: 'q7', kind: 'question_no', questionNo: '7', lineStart: 80, lineEnd: 80 },
      { id: 'q8', kind: 'question_no', questionNo: '8', lineStart: 95, lineEnd: 95 },
    ] as any
    expect(lineBelongsToQuestion(tokens, 86, '7')).toBe(true)
    expect(lineBelongsToQuestion(tokens, 95, '7')).toBe(false)
  })

  it('uses ordered question markers for ownership and card jumps', () => {
    const tokens = [
      { id: 'q1-range', kind: 'analysis_range', questionNo: '1', lineStart: 10, lineEnd: 80 },
      { id: 'q1', kind: 'question_no', questionNo: '1', lineStart: 20, lineEnd: 20 },
      { id: 'q2', kind: 'question_no', questionNo: '2', lineStart: 55, lineEnd: 55 },
    ] as any
    expect(questionNoForLine(tokens, 60)).toBe('2')
    expect(questionStartLine(tokens, '2')).toBe(55)
  })
})
