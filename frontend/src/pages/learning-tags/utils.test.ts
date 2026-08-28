import { describe, expect, it } from 'vitest'
import { parseImportedLibrary, stringifyLibrary } from './utils'

describe('learning tag JSON import contract', () => {
  it('accepts each explicit library shape and preserves method groups', () => {
    const knowledge = parseImportedLibrary({
      libraryType: 'knowledge_point', code: 'kp_json', name: '知识点库', subject: '数学', stage: 'high_school',
      chapters: [{ code: 'CH_1', name: '第一章', knowledgePoints: [{ code: 'KP_1', name: '集合' }] }],
    })
    const method = parseImportedLibrary({
      libraryType: 'method_tag', code: 'method_json', name: '方法库', subject: '数学', stage: 'high_school',
      groups: [{ code: 'MG_1', name: '方法分组', tags: [{ code: 'MT_1', name: '换元', tagType: 'method' }] }],
    })

    expect(knowledge.libraryType).toBe('knowledge_point')
    expect(method).toMatchObject({ libraryType: 'method_tag', chapters: [{ code: 'MG_1', knowledgePoints: [{ code: 'MT_1' }] }] })
    expect(JSON.parse(stringifyLibrary(method))).toHaveProperty('groups')
    expect(JSON.parse(stringifyLibrary(method))).not.toHaveProperty('chapters')
  })

  it.each([
    { code: 'missing_type', name: '缺少类型', subject: '数学', stage: 'high_school', chapters: [] },
    { libraryType: 'method', code: 'wrong_type', name: '错误类型', subject: '数学', stage: 'high_school', chapters: [] },
    { libraryType: 'knowledge_point', code: 'wrong_shape', name: '错误结构', subject: '数学', stage: 'high_school', groups: [] },
  ])('rejects schema values that previously defaulted silently', (payload) => {
    expect(() => parseImportedLibrary(payload)).toThrow(/schema/)
  })
})
