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
let cropCalls = []
cp.execFileSync = (command, args, options) => {
  if (command.includes('crop_manual_annotation.py') || (args && args.some(a => String(a).includes('crop_manual_annotation.py')))) {
    cropCalls.push(args.map(String))
    return JSON.stringify({ results: mockedResults })
  }
  if (command.includes('render_pdf_page.py') || (args && args.some(a => String(a).includes('render_pdf_page.py')))) {
    return ""
  }
  return originalExecFileSync(command, args, options)
}

const { closeDatabase } = await import('../dist/index.js')
const { db } = await import('../dist/db/connection.js')
const {
  createOrRestoreCandidateFixSession,
  finalizeCandidateFixSession,
  getCandidateFixSession,
  reopenCandidateFixSession,
  saveCandidateFixRegions,
} = await import('../dist/services/candidate-fix/candidate-fix.service.js')
const candidateService = await import('../dist/services/import-flow-v2/candidate.service.js')
const candidateRepo = await import('../dist/repositories/question-candidates.repo.js')

try {
  // 1. Mock DB data
  const docId = 'src_doc_test'
  const solutionDocId = 'src_solution_doc_test'
  const candidateId = 'candidate_test'
  const importJobId = 'ifv2job_manual_fix_test'
  
  db.prepare(`
    INSERT INTO source_documents (id, title, original_file_name, file_path, file_type, page_count, provider, status, created_at, updated_at)
    VALUES (?, 'Test PDF', 'test.pdf', 'import-flow-v2/source-documents/src_doc_test/test.pdf', 'pdf', 3, 'glm', 'uploaded', '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')
  `).run(docId)

  db.prepare(`
    INSERT INTO source_documents (id, title, original_file_name, file_path, file_type, page_count, provider, status, created_at, updated_at)
    VALUES (?, 'Solution PDF', 'solution.pdf', 'import-flow-v2/source-documents/src_solution_doc_test/solution.pdf', 'pdf', 4, 'glm', 'uploaded', '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')
  `).run(solutionDocId)

  db.prepare(`
    INSERT INTO import_jobs (id, title, mode, status, created_at, updated_at)
    VALUES (?, 'Manual Fix Job', 'separated_documents', 'parsed', '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')
  `).run(importJobId)
  db.prepare(`
    INSERT INTO import_job_documents (id, job_id, source_document_id, role, sort_order, created_at, updated_at)
    VALUES ('jobdoc_questions', ?, ?, 'questions', 0, '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')
  `).run(importJobId, docId)
  db.prepare(`
    INSERT INTO import_job_documents (id, job_id, source_document_id, role, sort_order, created_at, updated_at)
    VALUES ('jobdoc_solutions', ?, ?, 'solutions', 1, '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')
  `).run(importJobId, solutionDocId)

  const initialFigures = [{
    id: 'fig_solution_existing',
    usage: 'analysis',
    path: 'import-flow-v2/source-documents/src_solution_doc_test/assets/fig_solution.png',
    sourceDocumentId: solutionDocId,
    pageNo: 2,
    bbox: [0.1, 0.2, 0.4, 0.5],
  }]
  const initialSourceRefs = [
    { sourceDocumentId: docId, pageNo: 1, blockIds: [], kind: 'stem', bbox: [0.1, 0.1, 0.6, 0.3] },
    { sourceDocumentId: solutionDocId, pageNo: 2, blockIds: [], kind: 'analysis', bbox: [0.1, 0.2, 0.6, 0.5] },
  ]
  db.prepare(`
    INSERT INTO question_candidates (id, source_document_id, ocr_document_id, question_no, stem_markdown, answer_text, analysis_markdown, figures_json, source_refs_json, status, issues_json, created_at, updated_at)
    VALUES (?, ?, 'ocr_doc_test', '1', '1. 计算 $1+1=2$。', '2', '因为 $1+1=2$。', ?, ?, 'needs_manual_fix', '[]', '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')
  `).run(candidateId, docId, JSON.stringify(initialFigures), JSON.stringify(initialSourceRefs))

  // 2. Test V2-native create/restore
  console.log('Testing createOrRestoreCandidateFixSession...')
  const session = createOrRestoreCandidateFixSession(candidateId)
  assert.equal(session.candidateId, candidateId)
  assert.equal(session.status, 'draft')
  assert.equal(Boolean(session.sourceProfiles[solutionDocId]), true)
  const initialAnalysisRegion = session.regions.find((region) => region.kind === 'solution')
  assert.equal(initialAnalysisRegion?.sourceDocumentId, solutionDocId)
  const initialAnalysisFigureRegion = session.regions.find((region) => region.kind === 'shared_answer_key' && region.questionKeys?.includes('fig_solution_existing'))
  assert.equal(initialAnalysisFigureRegion?.sourceDocumentId, solutionDocId)
  const restoredSession = createOrRestoreCandidateFixSession(candidateId)
  assert.equal(restoredSession.id, session.id)

  db.prepare('UPDATE question_candidates SET figures_json = ?, source_refs_json = ? WHERE id = ?').run('[]', '[]', candidateId)
  
  // 3. Test saving coordinates, ownership validation, and optimistic concurrency
  console.log('Testing saveCandidateFixRegions for candidate session...')
  const mockRegions = [
    {
      id: 'reg_stem',
      sourceDocumentId: docId,
      kind: 'question',
      questionLabel: '题干',
      segments: [{ page: 1, x: 0.1, y: 0.1, width: 0.5, height: 0.2 }],
      sortOrder: 0,
      note: ''
    },
    {
      id: 'reg_analysis',
      sourceDocumentId: solutionDocId,
      kind: 'solution',
      questionLabel: '解析',
      segments: [{ page: 1, x: 0.1, y: 0.4, width: 0.5, height: 0.2 }],
      sortOrder: 1,
      note: ''
    },
    {
      id: 'reg_new_figure',
      sourceDocumentId: docId,
      kind: 'shared_answer_key',
      questionLabel: '题图',
      segments: [{ page: 2, x: 0.2, y: 0.2, width: 0.4, height: 0.3 }],
      sortOrder: 2,
      note: 'analysis'
    }
  ]

  const savedSession = saveCandidateFixRegions(session.id, mockRegions, session.revision)
  assert.equal(savedSession.regions.length, 3)
  assert.throws(() => saveCandidateFixRegions(session.id, mockRegions, session.revision), (error) => error?.status === 409)
  assert.throws(() => saveCandidateFixRegions(session.id, [{ ...mockRegions[0], sourceDocumentId: 'not-owned' }], savedSession.revision), (error) => error?.status === 400)
  assert.throws(() => saveCandidateFixRegions(session.id, [{ ...mockRegions[0], segments: [{ page: 9, x: 0, y: 0, width: 1, height: 1 }] }], savedSession.revision), (error) => error?.status === 400)

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
  cropCalls = []

  const finalized = finalizeCandidateFixSession(session.id, {
    stemMarkdown: '1. 计算 $1+1$。',
    analysisMarkdown: '解析：1 加 1 的结果为 2。'
  })
  assert.equal(finalized.session.status, 'finalized')
  assert.equal(cropCalls.length, 2)
  assert.equal(cropCalls.some((args) => args.includes(path.join(tempRoot, 'import-flow-v2', 'source-documents', solutionDocId, 'solution.pdf'))), true)

  // 5. Verify database updates on Candidate
  const updatedCandidate = db.prepare('SELECT * FROM question_candidates WHERE id = ?').get(candidateId)
  
  assert.match(updatedCandidate.stem_markdown, /1\. 计算 \$1\+1\$。/)
  assert.match(updatedCandidate.analysis_markdown, /解析：1 加 1 的结果为 2。/)
  assert.doesNotMatch(updatedCandidate.stem_markdown, /<!-- DOC2X_FIGURE:fig_manual_/) // Analysis figures should not be appended to stem.
  assert.match(updatedCandidate.analysis_markdown, /<!-- DOC2X_FIGURE:fig_manual_/) // Verify figure placeholder auto-appended to analysis.
  
  const figures = JSON.parse(updatedCandidate.figures_json)
  assert.equal(figures.length, 1)
  assert.equal(figures[0].usage, 'analysis')
  assert.equal(figures[0].sourceDocumentId, docId)
  assert.equal(figures[0].pageNo, 2)
  assert.deepEqual(figures[0].bbox, [0.2, 0.2, 0.6, 0.5])
  
  const sourceRefs = JSON.parse(updatedCandidate.source_refs_json)
  assert.equal(sourceRefs.length, 2)
  assert.equal(sourceRefs[0].kind, 'stem')
  assert.equal(sourceRefs[0].sourceDocumentId, docId)
  assert.equal(sourceRefs[0].pageNo, 1)
  assert.deepEqual(sourceRefs[0].bbox, [0.1, 0.1, 0.6, 0.3])
  assert.equal(sourceRefs[1].kind, 'analysis')
  assert.equal(sourceRefs[1].sourceDocumentId, solutionDocId)
  assert.equal(sourceRefs[1].pageNo, 1)
  assert.deepEqual(sourceRefs[1].bbox, [0.1, 0.4, 0.6, 0.6])

  // Verify status is updated to ready because errors are cleared
  assert.equal(updatedCandidate.status, 'ready')

  const beforeEdit = candidateRepo.getQuestionCandidate(candidateId)
  const edited = candidateService.updateQuestionCandidate(candidateId, {
    expectedContentRevision: beforeEdit.contentRevision,
    answerText: '新答案',
  }).candidate
  assert.equal(edited.contentRevision, beforeEdit.contentRevision + 1)
  assert.throws(
    () => candidateService.updateQuestionCandidate(candidateId, { expectedContentRevision: beforeEdit.contentRevision, answerText: '过期答案' }),
    (error) => error?.status === 409 && error?.body?.actualContentRevision === edited.contentRevision,
  )
  candidateRepo.updateQuestionCandidate(candidateId, { status: 'committed', committedQuestionId: 'qb_committed' })
  assert.throws(
    () => candidateService.updateQuestionCandidate(candidateId, { expectedContentRevision: edited.contentRevision, stemMarkdown: '禁止修改' }),
    (error) => error?.status === 409 && error?.body?.error === 'candidate_committed' && error?.body?.committedQuestionId === 'qb_committed',
  )
  
  const finalizedSession = getCandidateFixSession(session.id)
  assert.equal(finalizedSession.status, 'finalized')

  candidateRepo.updateQuestionCandidate(candidateId, { status: 'needs_review', committedQuestionId: '', committedAt: '' })
  const reopened = reopenCandidateFixSession(session.id)
  assert.equal(reopened.status, 'draft')
  assert.equal(reopened.revision, finalizedSession.revision + 1)

  const beforeFailedFinalize = candidateRepo.getQuestionCandidate(candidateId)
  mockedResults = [{ regionId: 'reg_stem', error: 'forced crop failure' }]
  assert.throws(() => finalizeCandidateFixSession(session.id), (error) => error?.status === 500)
  const afterFailedFinalize = candidateRepo.getQuestionCandidate(candidateId)
  assert.equal(afterFailedFinalize.contentRevision, beforeFailedFinalize.contentRevision)
  assert.equal(getCandidateFixSession(session.id).status, 'draft')

  candidateRepo.updateQuestionCandidate(candidateId, { status: 'committed', committedQuestionId: 'qb_committed' })
  assert.throws(() => saveCandidateFixRegions(session.id, mockRegions, reopened.revision), (error) => error?.status === 409)

  console.log('集成测试全部通过 (Integrational tests passed)!')
} finally {
  closeDatabase()
  cp.execFileSync = originalExecFileSync
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
