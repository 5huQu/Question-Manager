import { db } from '../../db/connection.js'
import { RouteError } from '../../utils/http-error.js'

type QuestionOcrSource = {
  source_document_id: string
  import_job_id: string
}

/**
 * Question-bank OCR no longer fabricates pdf_slicer runs. V2 OCR is owned by the
 * source document task lifecycle; committed questions are intentionally edited
 * through their import batch so candidate revisions remain auditable.
 */
export function rerunQuestionBankItemOcr(questionId: string) {
  const source = db.prepare(`
    SELECT candidate.source_document_id, job_document.job_id AS import_job_id
    FROM question_candidates candidate
    LEFT JOIN import_job_documents job_document
      ON job_document.source_document_id = candidate.source_document_id
    WHERE candidate.committed_question_id = ?
    ORDER BY candidate.committed_at DESC, job_document.sort_order ASC
    LIMIT 1
  `).get(questionId) as QuestionOcrSource | undefined

  if (source?.source_document_id) {
    throw new RouteError(409, '已入库题目的 OCR 由 V2 导入批次管理，请回到原导入资料重新识别。', {
      importJobId: source.import_job_id || '',
      sourceDocumentId: source.source_document_id,
    })
  }

  throw new RouteError(410, '旧版切题 OCR 重跑已退役；历史题目仍可编辑，但不会再创建 V1 run。')
}
