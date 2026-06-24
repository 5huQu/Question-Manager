import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import cp from 'node:child_process'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-manual-fix-test-'))
process.env.QUESTION_DATA_DIR = tempRoot

// Mock Python crop child process execution to avoid real PDF rendering/cropping dependencies
const originalExecFileSync = cp.execFileSync
let mockedResults = []
cp.execFileSync = (command, args, options) => {
  if (command.includes('crop_manual_annotation.py') || (args && args.some(a => String(a).includes('crop_manual_annotation.py')))) {
    return JSON.stringify({ results: mockedResults })
  }
  if (command.includes('render_pdf_page.py') || (args && args.some(a => String(a).includes('render_pdf_page.py')))) {
    return ""
  }
  return originalExecFileSync(command, args, options)
}

const { closeDatabase } = await import('../dist/index.js')
const { db } = await import('../dist/db/connection.js')
const { createOrRestoreCandidateManualFixSession, renderSourceDocumentPage } = await import('../dist/services/import-flow-v2/import-flow-v2.service.js')
const { saveRegions, finalizeSession, getSession } = await import('../dist/services/pdf-slicer/annotations.service.js')

try {
  // 1. Mock DB data
  const docId = 'src_doc_test'
  const candidateId = 'candidate_test'
  
  db.prepare(`
    INSERT INTO source_documents (id, title, original_file_name, file_path, file_type, page_count, provider, status, created_at, updated_at)
    VALUES (?, 'Test PDF', 'test.pdf', 'import-flow-v2/source-documents/src_doc_test/test.pdf', 'pdf', 3, 'glm', 'uploaded', '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')
  `).run(docId)

  db.prepare(`
    INSERT INTO question_candidates (id, source_document_id, ocr_document_id, question_no, stem_markdown, answer_text, analysis_markdown, figures_json, source_refs_json, status, issues_json, created_at, updated_at)
    VALUES (?, ?, 'ocr_doc_test', '1', '1. 计算 $1+1=2$。', '2', '因为 $1+1=2$。', '[]', '[]', 'needs_manual_fix', '[]', '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')
  `).run(candidateId, docId)

  // 2. Test createOrRestoreCandidateManualFixSession
  console.log('Testing createOrRestoreCandidateManualFixSession...')
  const session = createOrRestoreCandidateManualFixSession(candidateId)
  assert.equal(session.id, `sess_candidate_${candidateId}`)
  assert.equal(session.batchId, candidateId)
  assert.equal(session.status, 'draft')
  
  // 3. Test saveRegions (saving coordinates draft)
  console.log('Testing saveRegions for candidate session...')
  const mockRegions = [
    {
      id: 'reg_stem',
      sourceRunId: docId,
      kind: 'question',
      questionLabel: '题干',
      segments: [{ page: 1, x: 0.1, y: 0.1, width: 0.5, height: 0.2 }],
      sortOrder: 0,
      note: ''
    },
    {
      id: 'reg_analysis',
      sourceRunId: docId,
      kind: 'solution',
      questionLabel: '解析',
      segments: [{ page: 1, x: 0.1, y: 0.4, width: 0.5, height: 0.2 }],
      sortOrder: 1,
      note: ''
    },
    {
      id: 'reg_new_figure',
      sourceRunId: docId,
      kind: 'shared_answer_key',
      questionLabel: '题图',
      segments: [{ page: 2, x: 0.2, y: 0.2, width: 0.4, height: 0.3 }],
      sortOrder: 2,
      note: 'stem'
    }
  ]

  const savedSession = saveRegions(session.id, mockRegions, session.revision)
  assert.equal(savedSession.regions.length, 3)

  // 4. Test finalizeSession with new markdown & cropping mock
  console.log('Testing finalizeSession for candidate...')
  
  // Set up mock python crop outputs for our regions
  const expectedImgPath = path.join(tempRoot, 'data', 'import-flow-v2', 'source-documents', docId, 'assets', 'figure_stitched.png')
  fs.mkdirSync(path.dirname(expectedImgPath), { recursive: true })
  fs.writeFileSync(expectedImgPath, 'mock-png-content')

  mockedResults = [
    { regionId: 'reg_stem', kind: 'question', questionKey: 'stem', imagePath: '/dummy/stem.png' },
    { regionId: 'reg_analysis', kind: 'solution', questionKey: 'analysis', imagePath: '/dummy/analysis.png' },
    { regionId: 'reg_new_figure', kind: 'shared_answer_key', questionKey: 'figure', imagePath: expectedImgPath }
  ]

  finalizeSession(session.id, {
    stemMarkdown: '1. 计算 $1+1$。',
    analysisMarkdown: '解析：1 加 1 的结果为 2。'
  })

  // 5. Verify database updates on Candidate
  const updatedCandidate = db.prepare('SELECT * FROM question_candidates WHERE id = ?').get(candidateId)
  
  assert.match(updatedCandidate.stem_markdown, /1\. 计算 \$1\+1\$。/)
  assert.match(updatedCandidate.stem_markdown, /<!-- DOC2X_FIGURE:fig_manual_/) // Verify figure placeholder auto-appended
  assert.match(updatedCandidate.analysis_markdown, /解析：1 加 1 的结果为 2。/)
  
  const figures = JSON.parse(updatedCandidate.figures_json)
  assert.equal(figures.length, 1)
  assert.equal(figures[0].usage, 'stem')
  assert.equal(figures[0].pageNo, 2)
  assert.deepEqual(figures[0].bbox, [0.2, 0.2, 0.6, 0.5])
  
  const sourceRefs = JSON.parse(updatedCandidate.source_refs_json)
  assert.equal(sourceRefs.length, 2)
  assert.equal(sourceRefs[0].kind, 'stem')
  assert.equal(sourceRefs[0].pageNo, 1)
  assert.deepEqual(sourceRefs[0].bbox, [0.1, 0.1, 0.6, 0.3])
  assert.equal(sourceRefs[1].kind, 'analysis')
  assert.equal(sourceRefs[1].pageNo, 1)
  assert.deepEqual(sourceRefs[1].bbox, [0.1, 0.4, 0.6, 0.6])

  // Verify status is updated to ready because errors are cleared
  assert.equal(updatedCandidate.status, 'ready')
  
  const finalizedSession = getSession(session.id)
  assert.equal(finalizedSession.status, 'finalized')

  console.log('集成测试全部通过 (Integrational tests passed)!')
} finally {
  closeDatabase()
  cp.execFileSync = originalExecFileSync
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
