import { importV2Api } from '@/api/importV2'
import { queryClient } from '@/lib/queryCache'

export const importV2QueryKeys = {
  root: ['import-v2'] as const,
  sourceDocuments: ['import-v2', 'source-documents'] as const,
  ocrDocuments: ['import-v2', 'ocr-documents'] as const,
  parserConfig: ['import-v2', 'parser-config'] as const,
  parserPresets: ['import-v2', 'parser-presets'] as const,
  importJob: (jobId: string) => ['import-v2', 'jobs', jobId] as const,
  candidates: (sourceDocumentId: string) => ['import-v2', 'source-documents', sourceDocumentId, 'candidates'] as const,
}

export function fetchSourceDocuments(options: { force?: boolean } = {}) {
  return queryClient.fetchQuery(importV2QueryKeys.sourceDocuments, () => importV2Api.listSourceDocuments(), options)
}

export function fetchOcrDocuments(options: { force?: boolean } = {}) {
  return queryClient.fetchQuery(importV2QueryKeys.ocrDocuments, () => importV2Api.listOcrDocuments(), options)
}

export function fetchParserPresets(options: { force?: boolean } = {}) {
  return queryClient.fetchQuery(importV2QueryKeys.parserPresets, () => importV2Api.listParserPresets(), options)
}

export function fetchParserConfig(options: { force?: boolean } = {}) {
  return queryClient.fetchQuery(importV2QueryKeys.parserConfig, () => importV2Api.getParserConfig(), options)
}

export function fetchImportJob(jobId: string, options: { force?: boolean } = {}) {
  return queryClient.fetchQuery(importV2QueryKeys.importJob(jobId), () => importV2Api.getImportJob(jobId), options)
}

export function fetchCandidates(sourceDocumentId: string, options: { force?: boolean } = {}) {
  return queryClient.fetchQuery(importV2QueryKeys.candidates(sourceDocumentId), () => importV2Api.listCandidates(sourceDocumentId), options)
}

export function invalidateImportV2Queries() {
  queryClient.invalidateQueries(importV2QueryKeys.root)
}
