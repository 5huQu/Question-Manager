import type { Express } from 'express'
import { mountCandidateRoutes } from './candidates.js'
import { mountImportJobRoutes } from './jobs.js'
import { mountOcrDocumentRoutes } from './ocr-documents.js'
import { mountParserRoutes } from './parser.js'
import { mountSourceDocumentRoutes } from './source-documents.js'

export function mountImportFlowV2Routes(app: Express) {
  mountParserRoutes(app)
  mountImportJobRoutes(app)
  mountSourceDocumentRoutes(app)
  mountOcrDocumentRoutes(app)
  mountCandidateRoutes(app)
}
