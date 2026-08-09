import { describe, expect, it } from 'vitest'
import { orderedManualFixSegments } from './manualFixPdfClipboard'

describe('orderedManualFixSegments', () => {
  it('keeps each manual-fix region on its own source document and sorts its PDF coordinates', () => {
    const regions = [
      {
        id: 'solution', sourceRunId: 'solution-document', kind: 'solution' as const, questionLabel: '解析', questionKeys: [], sortOrder: 1, note: '',
        segments: [{ page: 2, x: 0.1, y: 0.4, width: 0.5, height: 0.2 }, { page: 1, x: 0.1, y: 0.5, width: 0.5, height: 0.2 }],
      },
      {
        id: 'question', sourceRunId: 'question-document', kind: 'question' as const, questionLabel: '题干', questionKeys: [], sortOrder: 0, note: '',
        segments: [{ page: 3, x: 0.1, y: 0.2, width: 0.5, height: 0.2 }],
      },
    ]

    expect(orderedManualFixSegments(regions, 'solution', 'fallback-document')).toEqual([
      { sourceDocumentId: 'solution-document', segment: regions[0].segments[1] },
      { sourceDocumentId: 'solution-document', segment: regions[0].segments[0] },
    ])
    expect(orderedManualFixSegments(regions, 'question', 'fallback-document')).toEqual([
      { sourceDocumentId: 'question-document', segment: regions[1].segments[0] },
    ])
  })
})
