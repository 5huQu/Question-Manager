import { describe, expect, it } from 'vitest'
import {
  candidateDetailPath,
  candidateManualFixPath,
  candidateReviewPath,
  importJobDocumentPath,
  importJobPath,
  importJobQuestionsPath,
  legacySourceDocumentPath,
} from './importV2Routes'

describe('import V2 route builders', () => {
  it('builds canonical job, document, and candidate paths with encoded ids', () => {
    const documentPath = importJobDocumentPath('job/1', 'source 2')
    expect(importJobPath('job/1')).toBe('/tools/import/jobs/job%2F1')
    expect(documentPath).toBe('/tools/import/jobs/job%2F1/documents/source%202')
    expect(importJobQuestionsPath('job/1')).toBe('/tools/import/jobs/job%2F1/questions')
    expect(candidateReviewPath(documentPath, 'tab=warning')).toBe(`${documentPath}/candidates?tab=warning`)
    expect(candidateDetailPath(documentPath, 'candidate/3', '?tab=error')).toBe(`${documentPath}/candidates/candidate%2F3?tab=error`)
    expect(candidateManualFixPath(documentPath, 'candidate/3')).toBe(`${documentPath}/candidates/candidate%2F3/manual-fix`)
  })

  it('keeps the legacy document path isolated for compatibility redirects', () => {
    expect(legacySourceDocumentPath('source/1')).toBe('/tools/import/documents/source%2F1')
  })
})
