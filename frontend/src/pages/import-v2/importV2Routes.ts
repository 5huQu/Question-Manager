export function importJobPath(importJobId: string) {
  return `/tools/import/jobs/${encodeURIComponent(importJobId)}`
}

export function importJobDocumentPath(importJobId: string, sourceDocumentId: string) {
  return `${importJobPath(importJobId)}/documents/${encodeURIComponent(sourceDocumentId)}`
}

export function importJobQuestionsPath(importJobId: string) {
  return `${importJobPath(importJobId)}/questions`
}

export function legacySourceDocumentPath(sourceDocumentId: string) {
  return `/tools/import/documents/${encodeURIComponent(sourceDocumentId)}`
}

export function candidateReviewPath(documentPath: string, search = '') {
  return `${documentPath}/candidates${normalizeSearch(search)}`
}

export function candidateDetailPath(documentPath: string, candidateId: string, search = '') {
  return `${documentPath}/candidates/${encodeURIComponent(candidateId)}${normalizeSearch(search)}`
}

export function candidateManualFixPath(documentPath: string, candidateId: string, search = '') {
  return `${documentPath}/candidates/${encodeURIComponent(candidateId)}/manual-fix${normalizeSearch(search)}`
}

function normalizeSearch(search: string) {
  const value = search.replace(/^\?/, '')
  return value ? `?${value}` : ''
}
