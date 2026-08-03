import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'question-manager-doc2x-package-'))
process.env.QUESTION_DATA_DIR = tempRoot
process.env.QUESTION_AUTH_MODE = 'disabled'

const { ensureSchema } = await import('../dist/db/schema.js')
const { db, closeDatabase } = await import('../dist/db/connection.js')
const { importDoc2xMarkdownPackage } = await import('../dist/services/import-flow-v2/doc2x-package.service.js')
const { sourceDocumentDir, storedOcrDocumentDir } = await import('../dist/services/import-flow-v2/import-flow-v2.paths.js')
const { resolveStoragePath } = await import('../dist/utils/paths.js')

function makePackage(name, markdown = '# Doc2X 测试\n\n题目内容\n\n![图](images/001.png)') {
  const packageDir = path.join(tempRoot, 'fixtures', name)
  fs.mkdirSync(path.join(packageDir, 'images'), { recursive: true })
  fs.writeFileSync(path.join(packageDir, 'result.md'), `${markdown}\n`, 'utf8')
  fs.writeFileSync(path.join(packageDir, 'images', '001.png'), Buffer.from('fake-png'))
  const zipPath = path.join(tempRoot, 'fixtures', `${name}.zip`)
  execFileSync('zip', ['-q', '-r', zipPath, '.'], { cwd: packageDir })
  return {
    originalname: `${name}.zip`,
    mimetype: 'application/zip',
    path: zipPath,
    size: fs.statSync(zipPath).size,
  }
}

function directoryEntries(parent) {
  return fs.existsSync(parent) ? fs.readdirSync(parent).sort() : []
}

function sourceRoot() {
  return path.dirname(sourceDocumentDir('test'))
}

function ocrRoot() {
  return path.dirname(storedOcrDocumentDir('test'))
}

function rowCount(table, column, value) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`).get(value).count)
}

ensureSchema()

try {
  console.log('1. A valid Doc2X package commits both records and all files...')
  const successTitle = 'doc2x-success'
  const success = await importDoc2xMarkdownPackage(makePackage('success'), { title: successTitle })
  assert.ok(success.sourceDocument)
  assert.ok(success.ocrDocument)
  assert.equal(success.ocrDocument.sourceDocumentId, success.sourceDocument.id)
  const successSourceDir = sourceDocumentDir(success.sourceDocument.id)
  const successOcrDir = storedOcrDocumentDir(success.ocrDocument.id)
  assert.equal(fs.existsSync(path.join(successSourceDir, 'doc2x-export.zip')), true)
  assert.equal(fs.existsSync(path.join(successSourceDir, 'doc2x-original.md')), true)
  for (const portablePath of [
    success.ocrDocument.rawResultPath,
    success.ocrDocument.markdownPath,
    success.ocrDocument.blocksJsonPath,
    success.ocrDocument.assetsJsonPath,
  ]) {
    assert.equal(fs.existsSync(resolveStoragePath(portablePath)), true, portablePath)
  }
  assert.equal(fs.existsSync(path.join(successSourceDir, 'assets')), true)
  assert.equal(fs.existsSync(path.join(successOcrDir, 'manual-package.json')), true)
  assert.equal(rowCount('source_documents', 'id', success.sourceDocument.id), 1)
  assert.equal(rowCount('ocr_documents', 'id', success.ocrDocument.id), 1)

  console.log('2. A database failure after source insertion rolls back both records and both directories...')
  const sourceBeforeTrigger = directoryEntries(sourceRoot())
  const ocrBeforeTrigger = directoryEntries(ocrRoot())
  const ocrRowsBeforeTrigger = Number(db.prepare('SELECT COUNT(*) AS count FROM ocr_documents').get().count)
  const forcedTitle = 'forced-ocr-insert'
  db.exec(`
    CREATE TRIGGER fail_doc2x_ocr_insert
    BEFORE INSERT ON ocr_documents
    BEGIN SELECT RAISE(ABORT, 'forced Doc2X OCR insert failure'); END;
  `)
  await assert.rejects(
    importDoc2xMarkdownPackage(makePackage('forced-ocr-insert'), { title: forcedTitle }),
    /forced Doc2X OCR insert failure/,
  )
  db.exec('DROP TRIGGER fail_doc2x_ocr_insert')
  assert.equal(rowCount('source_documents', 'title', forcedTitle), 0)
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM ocr_documents').get().count), ocrRowsBeforeTrigger)
  assert.deepEqual(directoryEntries(sourceRoot()), sourceBeforeTrigger)
  assert.deepEqual(directoryEntries(ocrRoot()), ocrBeforeTrigger)

  console.log('3. An OCR file-write failure cleans both directories and leaves no rows...')
  const fileFailureTitle = 'forced-file-failure'
  const sourceBeforeFileFailure = directoryEntries(sourceRoot())
  const ocrBeforeFileFailure = directoryEntries(ocrRoot())
  await assert.rejects(
    importDoc2xMarkdownPackage(makePackage('forced-file-failure'), { title: fileFailureTitle }, {
      beforeOcrFiles: ({ markdownPath }) => fs.mkdirSync(markdownPath, { recursive: true }),
    }),
    /EISDIR|directory|is a directory/i,
  )
  assert.equal(rowCount('source_documents', 'title', fileFailureTitle), 0)
  assert.deepEqual(directoryEntries(sourceRoot()), sourceBeforeFileFailure)
  assert.deepEqual(directoryEntries(ocrRoot()), ocrBeforeFileFailure)
  console.log('doc2x package service tests passed')
} finally {
  closeDatabase()
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
