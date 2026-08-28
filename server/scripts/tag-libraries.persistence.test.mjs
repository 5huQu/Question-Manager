import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'question-manager-tag-libraries-'))
process.env.QUESTION_DATA_DIR = tempRoot

const { tagLibrariesDir, tagLibrarySeedDir } = await import('../dist/config.js')
const { readLearningTagLibraries, writeLearningTagLibrary, writeLearningTagLibraries } = await import('../dist/services/tags/tag-libraries.js')

assert.equal(tagLibrariesDir, path.join(tempRoot, 'data', 'tag_libraries'))
assert.ok(fs.existsSync(path.join(tagLibrariesDir, 'high_school_methods.json')))
assert.ok(fs.existsSync(path.join(tagLibrarySeedDir, 'high_school_methods.json')))

const methodLibrary = {
  libraryType: 'method_tag',
  code: 'high_school_methods',
  name: '可编辑方法题型标签库',
  subject: '数学',
  stage: 'high_school',
  groups: [{ code: 'MG_TEST', name: '测试分组', tags: [{ code: 'MT_TEST', name: '测试方法', tagType: 'method' }] }],
}
const updated = writeLearningTagLibrary(methodLibrary)

assert.equal(updated.name, '可编辑方法题型标签库')
assert.equal(JSON.parse(fs.readFileSync(path.join(tagLibrariesDir, 'high_school_methods.json'), 'utf8')).name, '可编辑方法题型标签库')
assert.notEqual(JSON.parse(fs.readFileSync(path.join(tagLibrarySeedDir, 'high_school_methods.json'), 'utf8')).name, '可编辑方法题型标签库')

const knowledgeLibrary = {
  libraryType: 'knowledge_point',
  code: 'json_contract_knowledge',
  name: 'JSON 知识点库',
  subject: '数学',
  stage: 'high_school',
  chapters: [{ code: 'CH_TEST', name: '测试章节', knowledgePoints: [{ code: 'KP_TEST', name: '测试知识点' }] }],
}
assert.equal(writeLearningTagLibrary(knowledgeLibrary).libraryType, 'knowledge_point')
assert.equal(writeLearningTagLibrary(methodLibrary).libraryType, 'method_tag')

for (const invalid of [
  { ...knowledgeLibrary, libraryType: 'method' },
  { ...knowledgeLibrary, libraryType: undefined },
  { ...knowledgeLibrary, library_type: 'method_tag', libraryType: undefined },
  { ...knowledgeLibrary, groups: [{ code: 'MG_BAD', name: '错误结构', tags: [{ code: 'MT_BAD', name: '错误标签' }] }] },
]) {
  assert.throws(() => writeLearningTagLibrary(invalid), /标签库 JSON schema 错误/)
}

assert.throws(() => writeLearningTagLibraries([
  { ...knowledgeLibrary, code: 'must_not_persist' },
  { ...methodLibrary, code: 'invalid_second', groups: [{ code: 'MG_INVALID', name: '无标签', tags: [] }] },
]), /标签库 JSON schema 错误/)
assert.equal(fs.existsSync(path.join(tagLibrariesDir, 'must_not_persist.json')), false, '批量校验失败时不得留下前一个标签库')

fs.rmSync(tempRoot, { recursive: true, force: true })
console.log('tag library persistence ok')
