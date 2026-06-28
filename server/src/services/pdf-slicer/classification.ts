import fs from 'node:fs'
import { readOcrSettings } from '../settings/ocr-settings.js'
import { nowIso } from '../../utils/ids.js'
import { runQuestionBatchClassification } from '../question-bank/batch-classification.js'

export function runQuestionClassification(runId: string): Promise<Record<string, any>> {
  return runQuestionBatchClassification({ type: 'pdf_slicer_run', id: runId })
}

export async function classifyRunAfterImport(runId: string, logPath?: string) {
  const settings = readOcrSettings()
  if (settings.classificationEnabled === 'false') return null
  try {
    const report = await runQuestionClassification(runId)
    if (logPath) {
      fs.appendFileSync(logPath, `[${nowIso()}] classification updated=${report.updated ?? 0} failed=${report.failed ?? 0}\n`)
    }
    return report
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (logPath) fs.appendFileSync(logPath, `[${nowIso()}] classification skipped/failed: ${message}\n`)
    return { failed: true, error: message }
  }
}
