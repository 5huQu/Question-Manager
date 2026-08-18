import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'question-manager-tag-libraries-'))
process.env.QUESTION_DATA_DIR = tempRoot

const { tagLibrariesDir, tagLibrarySeedDir } = await import('../dist/config.js')
const { readLearningTagLibraries, writeLearningTagLibrary } = await import('../dist/services/tags/tag-libraries.js')

assert.equal(tagLibrariesDir, path.join(tempRoot, 'data', 'tag_libraries'))
assert.ok(fs.existsSync(path.join(tagLibrariesDir, 'high_school_methods.json')))
assert.ok(fs.existsSync(path.join(tagLibrarySeedDir, 'high_school_methods.json')))

const library = readLearningTagLibraries().find((item) => item.code === 'high_school_methods')
assert.ok(library)
const updated = writeLearningTagLibrary({ ...library, name: '可编辑方法题型标签库' })

assert.equal(updated.name, '可编辑方法题型标签库')
assert.equal(JSON.parse(fs.readFileSync(path.join(tagLibrariesDir, 'high_school_methods.json'), 'utf8')).name, '可编辑方法题型标签库')
assert.notEqual(JSON.parse(fs.readFileSync(path.join(tagLibrarySeedDir, 'high_school_methods.json'), 'utf8')).name, '可编辑方法题型标签库')

fs.rmSync(tempRoot, { recursive: true, force: true })
console.log('tag library persistence ok')
