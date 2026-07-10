import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'import-job-service-test-'))
process.env.QUESTION_DATA_DIR = tempRoot

const { closeDatabase } = await import('../dist/index.js')
const { createSourceDocument } = await import('../dist/repositories/source-documents.repo.js')
const { createOcrDocument } = await import('../dist/repositories/ocr-documents.repo.js')
const {
  createImportJob,
  addSourceDocumentToImportJob,
  parseCandidatesForImportJob,
  parseCandidatesForOcrDocument,
  listQuestionCandidatesForSource,
  commitQuestionCandidate,
  ensureSingleDocumentImportJob,
  listImportJobQuestions,
  resolveImportJobForLegacyRunId,
  refreshQuestionFormatStateForExport,
} = await import('../dist/services/import-flow-v2/import-flow-v2.service.js')
const { updateQuestionCandidate: persistQuestionCandidate } = await import('../dist/repositories/question-candidates.repo.js')
const { db } = await import('../dist/db/connection.js')
const { getQuestion } = await import('../dist/db/questions.js')
const { assetPathFor } = await import('../dist/utils/paths.js')

function block(markdown, content, id, pageNo = 1, type = 'text', cursorHint = 0) {
  const markdownStart = markdown.indexOf(content, cursorHint)
  assert.notEqual(markdownStart, -1, `test block content must exist in markdown: ${content}`)
  return {
    id,
    pageNo,
    type,
    content,
    markdownStart,
    markdownEnd: markdownStart + content.length,
    bbox: [20, 20 + markdownStart, 700, 60 + markdownStart],
  }
}

function blocks(markdown, entries) {
  let cursor = 0
  return entries.map((entry, index) => {
    const content = Array.isArray(entry) ? entry[0] : entry
    const id = Array.isArray(entry) ? entry[1] : `b_${index + 1}`
    const next = block(markdown, content, id, 1, 'text', cursor)
    cursor = next.markdownEnd
    return next
  })
}

function makeSourceDocument(id, title, metadata = {}) {
  const sourceDocument = createSourceDocument({
    id,
    title,
    originalFileName: `${id}.json`,
    filePath: `import-flow-v2/source-documents/${id}/original.json`,
    fileType: 'json',
    pageCount: 1,
    provider: 'glm',
    status: 'ocr_succeeded',
    metadata,
  })
  assert.ok(sourceDocument)
  return sourceDocument
}

function makeOcrDocument(id, sourceDocumentId, markdown, pageBlocks, assets = []) {
  const dir = path.join(tempRoot, 'data', 'import-flow-v2', 'source-documents', sourceDocumentId, id)
  fs.mkdirSync(dir, { recursive: true })
  const markdownPath = path.join(dir, 'markdown.md')
  const pagesPath = path.join(dir, 'pages.json')
  const assetsPath = path.join(dir, 'assets.json')
  const rawPath = path.join(dir, 'raw.json')
  fs.writeFileSync(markdownPath, markdown, 'utf8')
  fs.writeFileSync(pagesPath, JSON.stringify([{ pageNo: 1, width: 800, height: 1100, blocks: pageBlocks }]), 'utf8')
  fs.writeFileSync(assetsPath, JSON.stringify(assets), 'utf8')
  fs.writeFileSync(rawPath, JSON.stringify({ id, sourceDocumentId, markdown }), 'utf8')
  const ocrDocument = createOcrDocument({
    id,
    sourceDocumentId,
    provider: 'glm',
    rawResultPath: assetPathFor(rawPath),
    markdownPath: assetPathFor(markdownPath),
    blocksJsonPath: assetPathFor(pagesPath),
    assetsJsonPath: assetPathFor(assetsPath),
  })
  assert.ok(ocrDocument)
  return ocrDocument
}

try {
  console.log('1. Creating an import job and parsing a full document...')
  const fullSource = makeSourceDocument('src_job_full', 'Full Source')
  const fullMarkdown = [
    '1. 已知 $x=1$，求 $x+1$。',
    '答案：2',
    '解析：因为 $1+1=2$。',
  ].join('\n')
  makeOcrDocument('ocr_job_full', fullSource.id, fullMarkdown, blocks(fullMarkdown, [
    ['1. 已知 $x=1$，求 $x+1$。', 'b_full_stem'],
    ['答案：2', 'b_full_answer'],
    ['解析：因为 $1+1=2$。', 'b_full_analysis'],
  ]))

  const singleJob = createImportJob({
    id: 'job_single_document',
    title: 'Single Document Job',
    mode: 'single_document',
    paperTitle: 'Import Job Single Paper',
    examYear: 2026,
  })
  assert.equal(singleJob.importJob.mode, 'single_document')
  addSourceDocumentToImportJob(singleJob.importJob.id, { sourceDocumentId: fullSource.id, role: 'full' })
  const singleResult = parseCandidatesForImportJob(singleJob.importJob.id)
  assert.equal(singleResult.items.length, 1)
  assert.equal(singleResult.items[0].questionNo, '1')
  assert.equal(singleResult.items[0].answerText, '2')
  assert.match(singleResult.items[0].analysisMarkdown, /1\+1=2/)
  assert.equal(singleResult.items[0].paperTitle, 'Import Job Single Paper')

  console.log('2. Parsing separated questions and solutions into the same candidates...')
  const questionsSource = makeSourceDocument('src_job_questions', 'Questions Source', { paperTitle: 'Source Paper Should Be Overridden' })
  const solutionsSource = makeSourceDocument('src_job_solutions', 'Solutions Source')
  const questionsMarkdown = [
    '1. 已知 $x=1$，求 $x+1$。',
    '',
    '2. 已知 $a=2$，求 $2a$。',
  ].join('\n')
  makeOcrDocument('ocr_job_questions', questionsSource.id, questionsMarkdown, blocks(questionsMarkdown, [
    ['1. 已知 $x=1$，求 $x+1$。', 'b_q1_stem'],
    ['2. 已知 $a=2$，求 $2a$。', 'b_q2_stem'],
  ]))

  const solutionsMarkdown = [
    '1. 答案：2',
    '解析：因为 $1+1=2$。',
    '![解析图](analysis-1.png)',
    '',
    '2. 答案：4',
    '解析：因为 $2a=4$。',
    '',
    '3. 答案：6',
    '解析：这是多余解析。',
  ].join('\n')
  makeOcrDocument('ocr_job_solutions', solutionsSource.id, solutionsMarkdown, blocks(solutionsMarkdown, [
    ['1. 答案：2', 'b_s1_answer'],
    ['解析：因为 $1+1=2$。', 'b_s1_analysis'],
    ['2. 答案：4', 'b_s2_answer'],
    ['解析：因为 $2a=4$。', 'b_s2_analysis'],
    ['3. 答案：6', 'b_s3_answer'],
    ['解析：这是多余解析。', 'b_s3_analysis'],
  ]))

  const separatedJob = createImportJob({
    id: 'job_separated_documents',
    title: 'Separated Document Job',
    mode: 'separated_documents',
    paperTitle: 'Import Job Separated Paper',
    batchName: 'Separated Batch',
    examYear: 2026,
  })
  addSourceDocumentToImportJob(separatedJob.importJob.id, { sourceDocumentId: questionsSource.id, role: 'questions' })
  addSourceDocumentToImportJob(separatedJob.importJob.id, { sourceDocumentId: solutionsSource.id, role: 'solutions' })
  const separatedResult = parseCandidatesForImportJob(separatedJob.importJob.id)
  assert.equal(separatedResult.items.length, 2)
  const q1 = separatedResult.items.find((item) => item.questionNo === '1')
  const q2 = separatedResult.items.find((item) => item.questionNo === '2')
  assert.ok(q1)
  assert.ok(q2)
  assert.equal(q1.answerText, '2')
  assert.match(q1.analysisMarkdown, /1\+1=2/)
  assert.equal(q1.figures.some((figure) => figure.usage === 'analysis' && figure.path === 'analysis-1.png'), true)
  assert.equal(q1.sourceRefs.some((ref) => ref.kind === 'answer' && ref.blockIds.includes('b_s1_answer')), true)
  assert.equal(q1.sourceRefs.some((ref) => ref.kind === 'analysis' && ref.blockIds.includes('b_s1_analysis')), true)
  assert.equal(q1.issues.some((issue) => issue.code === 'unmatched_solution'), true)
  assert.equal(q2.answerText, '4')
  assert.match(q2.analysisMarkdown, /2a=4/)
  assert.equal(q2.status, 'ready')
  assert.equal(q2.paperTitle, 'Import Job Separated Paper')
  assert.equal(q2.batchName, 'Separated Batch')

  console.log('3. Committing a merged candidate to the bank...')
  const commitResult = await commitQuestionCandidate(q2.id, { skipAutoClassification: true })
  assert.equal(commitResult.candidate.status, 'committed')
  assert.equal(commitResult.item.answerText, '4')
  assert.equal(commitResult.item.analysisMarkdown.includes('2a=4'), true)
  assert.equal(commitResult.item.sourceRunId, '')
  assert.equal(commitResult.item.importSourceId, separatedJob.importJob.id)
  const separatedQuestions = listImportJobQuestions(separatedJob.importJob.id)
  assert.equal(separatedQuestions.items.length, 1)
  assert.equal(separatedQuestions.items[0].id, commitResult.item.id)

  console.log('4. Verifying direct OCRDocument parsing is unchanged...')
  const directSource = makeSourceDocument('src_direct_parse', 'Direct Parse Source')
  const directMarkdown = [
    '1. 已知 $b=4$，求 $2b$。',
    '答案：8',
    '解析：直接计算。',
  ].join('\n')
  const directOcr = makeOcrDocument('ocr_direct_parse', directSource.id, directMarkdown, blocks(directMarkdown, [
    ['1. 已知 $b=4$，求 $2b$。', 'b_direct_stem'],
    ['答案：8', 'b_direct_answer'],
    ['解析：直接计算。', 'b_direct_analysis'],
  ]))
  const directResult = parseCandidatesForOcrDocument(directOcr.id)
  assert.equal(directResult.items.length, 1)
  assert.equal(directResult.items[0].answerText, '8')
  const directCommit = await commitQuestionCandidate(directResult.items[0].id, { skipAutoClassification: true })
  assert.equal(directCommit.item.sourceRunId, '')
  assert.equal(directCommit.item.importSourceId, directSource.id)
  assert.throws(
    () => parseCandidatesForOcrDocument(directOcr.id),
    /已有题目入库/,
    're-parsing must not delete a committed candidate',
  )
  const preservedDirectCandidate = listQuestionCandidatesForSource(directSource.id, {}).items.find((item) => item.id === directResult.items[0].id)
  assert.equal(preservedDirectCandidate?.status, 'committed')
  assert.equal(getQuestion(directCommit.item.id)?.id, directCommit.item.id)
  const directJob = ensureSingleDocumentImportJob(directSource.id)
  assert.equal(directJob.importJob.mode, 'single_document')
  const directQuestions = listImportJobQuestions(directJob.importJob.id)
  assert.equal(directQuestions.items.length, 1)
  assert.equal(directQuestions.items[0].id, directCommit.item.id)
  const resolvedLegacy = resolveImportJobForLegacyRunId(`ifv2:${directSource.id}`)
  assert.equal(resolvedLegacy.importJob.id, directJob.importJob.id)

  const rollbackSource = makeSourceDocument('src_commit_rollback', 'Commit Rollback Source')
  const rollbackMarkdown = '1. 事务测试题\n答案：A'
  const rollbackOcr = makeOcrDocument('ocr_commit_rollback', rollbackSource.id, rollbackMarkdown, blocks(rollbackMarkdown, [
    ['1. 事务测试题', 'b_rollback_stem'],
    ['答案：A', 'b_rollback_answer'],
  ]))
  const rollbackCandidate = parseCandidatesForOcrDocument(rollbackOcr.id).items[0]
  db.exec(`
    CREATE TRIGGER fail_candidate_commit_for_test
    BEFORE UPDATE ON question_candidates
    WHEN OLD.id = '${rollbackCandidate.id}' AND NEW.status = 'committed'
    BEGIN
      SELECT RAISE(ABORT, 'forced candidate update failure');
    END
  `)
  await assert.rejects(
    () => commitQuestionCandidate(rollbackCandidate.id, { skipAutoClassification: true }),
    /forced candidate update failure/,
  )
  db.exec('DROP TRIGGER fail_candidate_commit_for_test')
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM question_bank_items WHERE import_source_id = ?').get(rollbackSource.id).count, 0)
  assert.notEqual(listQuestionCandidatesForSource(rollbackSource.id, {}).items[0]?.status, 'committed')

  console.log('5. Listing candidates recalculates stale persisted validation issues...')
  const staleSource = makeSourceDocument('src_live_validation', 'Live Validation Source')
  const staleMarkdown = [
    '1. 已知 $c=5$，求 $c$。',
    '解析：由题意直接得到 $c=5$。',
  ].join('\n')
  const staleOcr = makeOcrDocument('ocr_live_validation', staleSource.id, staleMarkdown, blocks(staleMarkdown, [
    ['1. 已知 $c=5$，求 $c$。', 'b_live_stem'],
    ['解析：由题意直接得到 $c=5$。', 'b_live_analysis'],
  ]))
  const staleResult = parseCandidatesForOcrDocument(staleOcr.id)
  assert.equal(staleResult.items.length, 1)
  assert.equal(staleResult.items[0].answerText, '')
  assert.match(staleResult.items[0].analysisMarkdown, /c=5/)
  persistQuestionCandidate(staleResult.items[0].id, {
    issues: [{ code: 'missing_answer', severity: 'warning', message: '未匹配到答案。' }],
    status: 'needs_review',
  })
  const liveResult = listQuestionCandidatesForSource(staleSource.id, {})
  assert.equal(liveResult.items.length, 1)
  assert.equal(liveResult.items[0].issues.some((issue) => issue.code === 'missing_answer'), false)
  assert.equal(liveResult.items[0].status, 'ready')
  const readyResult = listQuestionCandidatesForSource(staleSource.id, { status: 'ready' })
  assert.equal(readyResult.items.some((item) => item.id === staleResult.items[0].id), true)
  const reviewResult = listQuestionCandidatesForSource(staleSource.id, { status: 'needs_review' })
  assert.equal(reviewResult.items.some((item) => item.id === staleResult.items[0].id), false)

  console.log('6. Export preflight clears stale blocked format state...')
  const staleBlockedId = commitResult.item.id
  db.prepare(`
    UPDATE question_bank_items
    SET bank_status = 'blocked',
        format_review_required = 1,
        format_review_reasons_json = '{"reasons":["analysis:math_delimiter_unclosed"]}'
    WHERE id = ?
  `).run(staleBlockedId)
  let staleBlocked = getQuestion(staleBlockedId)
  assert.equal(staleBlocked.bankStatus, 'blocked')
  assert.equal(staleBlocked.needsFormatReview, true)
  const staleBlockedRows = db.prepare('SELECT * FROM question_bank_items WHERE id = ?').all(staleBlockedId)
  refreshQuestionFormatStateForExport(staleBlockedRows)
  staleBlocked = getQuestion(staleBlockedId)
  assert.equal(staleBlocked.bankStatus, 'ready')
  assert.equal(staleBlocked.needsFormatReview, false)

  console.log('import job service ok')
} catch (error) {
  console.error('Test failed:', error)
  process.exit(1)
} finally {
  closeDatabase()
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
