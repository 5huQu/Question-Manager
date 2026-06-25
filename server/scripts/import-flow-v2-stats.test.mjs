import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Set temporary question data directory for testing
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'import-flow-v2-stats-test-'))
process.env.QUESTION_DATA_DIR = tempRoot

const { closeDatabase } = await import('../dist/index.js')
const { db } = await import('../dist/db/connection.js')
const {
  createSourceDocument,
  getSourceDocument,
  listSourceDocuments,
} = await import('../dist/repositories/source-documents.repo.js')
const {
  createOcrDocument,
} = await import('../dist/repositories/ocr-documents.repo.js')
const {
  parseCandidatesForOcrDocument,
  commitQuestionCandidate,
} = await import('../dist/services/import-flow-v2/import-flow-v2.service.js')
const {
  getQuestion,
} = await import('../dist/db/questions.js')
const {
  assetPathFor,
} = await import('../dist/utils/paths.js')

try {
  console.log('1. Testing initial stats for a new source document...')
  const doc = createSourceDocument({
    id: 'src_stats_test_1',
    title: 'Test Stats Document',
    originalFileName: 'test_stats.pdf',
    filePath: 'import-flow-v2/source-documents/src_stats_test_1/test_stats.pdf',
    fileType: 'pdf',
    pageCount: 2,
    provider: 'glm',
    status: 'uploaded',
  })
  
  assert.ok(doc)
  assert.ok(doc.importStats)
  assert.equal(doc.importStats.ocrDocumentCount, 0)
  assert.equal(doc.importStats.candidateCount, 0)
  assert.equal(doc.importStats.readyCount, 0)
  assert.equal(doc.importStats.needsReviewCount, 0)
  assert.equal(doc.importStats.needsManualFixCount, 0)
  assert.equal(doc.importStats.blockedCount, 0)
  assert.equal(doc.importStats.committedCount, 0)
  assert.equal(doc.importStats.uncommittedCount, 0)
  assert.equal(doc.importStats.allCommitted, false)

  console.log('2. Mocking OCR result files on disk...')
  const localAssetsDir = path.join(tempRoot, 'data', 'import-flow-v2', 'source-documents', doc.id)
  fs.mkdirSync(localAssetsDir, { recursive: true })

  const markdownPath = path.join(localAssetsDir, 'ocr_result.md')
  const blocksJsonPath = path.join(localAssetsDir, 'blocks.json')
  const assetsJsonPath = path.join(localAssetsDir, 'assets.json')

  // Set up mock OCR contents containing one question block
  const markdownContent = '<!-- DOC2X_PAGE:1 -->\n1. 已知 $x=1$，求 $x+1$。\n答案：2\n解析：因为 $1+1=2$。'
  fs.writeFileSync(markdownPath, markdownContent, 'utf8')
  
  const blocksContent = [
    {
      pageNo: 1,
      width: 800,
      height: 1100,
      blocks: [
        {
          id: 'block_q1',
          pageNo: 1,
          type: 'text',
          content: '1. 已知 $x=1$，求 $x+1$。',
          markdownStart: markdownContent.indexOf('1. 已知'),
          markdownEnd: markdownContent.indexOf('1. 已知') + '1. 已知 $x=1$，求 $x+1$。'.length,
        }
      ]
    }
  ]
  fs.writeFileSync(blocksJsonPath, JSON.stringify(blocksContent), 'utf8')
  fs.writeFileSync(assetsJsonPath, JSON.stringify([]), 'utf8')

  console.log('3. Inserting OCRDocument record...')
  const ocrDoc = createOcrDocument({
    id: 'ocr_stats_test_1',
    sourceDocumentId: doc.id,
    provider: 'glm',
    rawResultPath: assetPathFor(path.join(localAssetsDir, 'raw.json')),
    markdownPath: assetPathFor(markdownPath),
    blocksJsonPath: assetPathFor(blocksJsonPath),
    assetsJsonPath: assetPathFor(assetsJsonPath),
  })
  assert.ok(ocrDoc)

  // Verify that ocrDocumentCount stats are updated
  const docAfterOcr = getSourceDocument(doc.id)
  assert.ok(docAfterOcr)
  assert.equal(docAfterOcr.importStats.ocrDocumentCount, 1)
  assert.equal(docAfterOcr.importStats.candidateCount, 0) // Parse hasn't run yet

  console.log('4. Parsing candidates for the OCR document...')
  const parseResult = parseCandidatesForOcrDocument(ocrDoc.id)
  assert.ok(parseResult)
  assert.ok(parseResult.items)
  assert.equal(parseResult.items.length, 1)
  
  const candidate = parseResult.items[0]
  assert.equal(candidate.questionNo, '1')

  // Verify stats updated after parsing candidates
  const docAfterParse = getSourceDocument(doc.id)
  assert.ok(docAfterParse)
  assert.equal(docAfterParse.importStats.ocrDocumentCount, 1)
  assert.equal(docAfterParse.importStats.candidateCount, 1)
  assert.equal(docAfterParse.importStats.readyCount, 1)
  assert.equal(docAfterParse.importStats.needsReviewCount, 0)
  assert.equal(docAfterParse.importStats.committedCount, 0)
  assert.equal(docAfterParse.importStats.uncommittedCount, 1)
  assert.equal(docAfterParse.importStats.allCommitted, false)

  console.log('5. Committing the candidate to the question bank...')
  const commitResult = commitQuestionCandidate(candidate.id)
  assert.ok(commitResult)
  assert.ok(commitResult.item)
  assert.equal(commitResult.candidate.status, 'committed')

  // Verify committed question properties
  const questionId = commitResult.item.id
  const question = getQuestion(questionId)
  assert.ok(question)
  assert.equal(question.sourceRunId, `ifv2:${doc.id}`)
  assert.equal(question.sourceTitle, 'Test Stats Document')

  // Verify stats updated after commit
  const docAfterCommit = getSourceDocument(doc.id)
  assert.ok(docAfterCommit)
  assert.equal(docAfterCommit.importStats.ocrDocumentCount, 1)
  assert.equal(docAfterCommit.importStats.candidateCount, 1)
  assert.equal(docAfterCommit.importStats.needsReviewCount, 0)
  assert.equal(docAfterCommit.importStats.committedCount, 1)
  assert.equal(docAfterCommit.importStats.uncommittedCount, 0)
  assert.equal(docAfterCommit.importStats.allCommitted, true)

  console.log('V2 statistics and link tracking integration tests passed successfully!');
} catch (error) {
  console.error('Test failed:', error)
  process.exit(1)
} finally {
  closeDatabase()
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  } catch {}
}
