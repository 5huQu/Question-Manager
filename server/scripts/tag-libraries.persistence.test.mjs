import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'question-manager-tag-libraries-'))
process.env.QUESTION_DATA_DIR = tempRoot

const { tagLibrariesDir, tagLibrarySeedDir } = await import('../dist/config.js')
const { readLearningTagLibraries, tagLibraryFilePath, writeLearningTagLibrary, writeLearningTagLibraries } = await import('../dist/services/tags/tag-libraries.js')

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
assert.equal(writeLearningTagLibrary({ ...knowledgeLibrary, code: 'UPPER_CASE_CODE' }).code, 'upper_case_code')

for (const invalid of [
  { ...knowledgeLibrary, libraryType: 'method' },
  { ...knowledgeLibrary, libraryType: undefined },
  { ...knowledgeLibrary, library_type: 'method_tag', libraryType: undefined },
  { ...knowledgeLibrary, groups: [{ code: 'MG_BAD', name: '错误结构', tags: [{ code: 'MT_BAD', name: '错误标签' }] }] },
  { ...knowledgeLibrary, code: '***' },
  { ...knowledgeLibrary, baseKnowledgeLibraryId: 1 },
  { ...knowledgeLibrary, chapters: [{ code: 'CH_TEST', name: '测试章节', sortOrder: '1', knowledgePoints: [{ code: 'KP_TEST', name: '测试知识点' }] }] },
  { ...knowledgeLibrary, chapters: [{ code: 'CH_TEST', name: '测试章节', knowledgePoints: [{ code: 'KP_TEST', name: '测试知识点', description: 1 }] }] },
  { ...knowledgeLibrary, chapters: [{ code: 'CH_TEST', name: '测试章节', knowledgePoints: [{ code: 'KP_TEST', name: '测试知识点', sortOrder: Number.NaN }] }] },
  { ...knowledgeLibrary, chapters: [{ code: 'CH_TEST', name: '测试章节', knowledgePoints: [{ code: 'KP_TEST', name: '测试知识点', appliesTo: ['单选题', 1] }] }] },
]) {
  assert.throws(() => writeLearningTagLibrary(invalid), /标签库 JSON schema 错误/)
}
assert.equal(fs.existsSync(tagLibraryFilePath('custom_library')), false, '非法 code 不得被静默归一化为 custom_library')

assert.throws(() => writeLearningTagLibraries([
  { ...knowledgeLibrary, code: 'must_not_persist' },
  { ...methodLibrary, code: 'invalid_second', groups: [{ code: 'MG_INVALID', name: '无标签', tags: [] }] },
]), /标签库 JSON schema 错误/)
assert.equal(fs.existsSync(path.join(tagLibrariesDir, 'must_not_persist.json')), false, '批量校验失败时不得留下前一个标签库')

const atomicA = { ...knowledgeLibrary, code: 'atomic_a', name: 'A 旧版' }
const atomicB = { ...knowledgeLibrary, code: 'atomic_b', name: 'B 旧版' }
writeLearningTagLibraries([atomicA, atomicB])
const atomicAPath = tagLibraryFilePath(atomicA.code)
const atomicBPath = tagLibraryFilePath(atomicB.code)
const atomicANew = { ...atomicA, name: 'A 新版' }
const atomicBNew = { ...atomicB, name: 'B 新版' }

assert.throws(() => writeLearningTagLibraries([atomicANew, atomicBNew], {
  existsSync: fs.existsSync,
  writeFileSync: fs.writeFileSync,
  unlinkSync: fs.unlinkSync,
  renameSync(from, to) {
    if (from.includes('.tmp') && to === atomicBPath) throw new Error('forced second target replacement failure')
    return fs.renameSync(from, to)
  },
}), /forced second target replacement failure/)
assert.equal(JSON.parse(fs.readFileSync(atomicAPath, 'utf8')).name, 'A 旧版', '第二个 target 替换失败时第一个文件必须恢复')
assert.equal(JSON.parse(fs.readFileSync(atomicBPath, 'utf8')).name, 'B 旧版', '第二个 target 替换失败时第二个文件必须恢复')

let backupCleanupCalls = 0
const cleanupResult = writeLearningTagLibraries([atomicANew, atomicBNew], {
  existsSync: fs.existsSync,
  writeFileSync: fs.writeFileSync,
  renameSync: fs.renameSync,
  unlinkSync(target) {
    if (target.includes('.bak')) {
      backupCleanupCalls += 1
      if (backupCleanupCalls === 2) throw new Error('forced second backup cleanup failure')
    }
    return fs.unlinkSync(target)
  },
})
assert.equal(cleanupResult.length, 2, '备份清理失败后导入仍应成功')
assert.equal(JSON.parse(fs.readFileSync(atomicAPath, 'utf8')).name, 'A 新版', '提交点后不得回滚第一个文件')
assert.equal(JSON.parse(fs.readFileSync(atomicBPath, 'utf8')).name, 'B 新版', '提交点后不得回滚第二个文件')

fs.rmSync(tempRoot, { recursive: true, force: true })
console.log('tag library persistence ok')
