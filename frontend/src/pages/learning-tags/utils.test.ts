import { describe, expect, it } from 'vitest'
import { parseImportedLibrary, stringifyLibrary } from './utils'

describe('learning tag JSON import contract', () => {
  it('accepts each explicit library shape and preserves method groups', () => {
    const knowledge = parseImportedLibrary({
      libraryType: 'knowledge_point', code: 'kp_json', name: '知识点库', subject: '数学', stage: 'high_school',
      chapters: [{ code: 'CH_1', name: '第一章', knowledgePoints: [{ code: 'KP_1', name: '集合' }] }],
    })
    const method = parseImportedLibrary({
      libraryType: 'method_tag', code: 'METHOD_JSON', name: '方法库', subject: '数学', stage: 'high_school',
      locale: 'zh-CN', version: '1.0.0', source: 'test', isDefault: false,
      baseKnowledgeLibraryId: 'kp-id', baseKnowledgeLibraryCode: 'kp_json', baseKnowledgeLibraryName: '知识点库',
      groups: [{ code: 'MG_1', name: '方法分组', sortOrder: 1, tags: [{ code: 'MT_1', name: '换元', description: '方法说明', tagType: 'method', appliesTo: ['单选题'], sortOrder: 1 }] }],
    })

    expect(knowledge.libraryType).toBe('knowledge_point')
    expect(method.code).toBe('method_json')
    expect(method).toMatchObject({ libraryType: 'method_tag', chapters: [{ code: 'MG_1', knowledgePoints: [{ code: 'MT_1' }] }] })
    const exported = JSON.parse(stringifyLibrary(method))
    expect(exported).toHaveProperty('groups')
    expect(exported).not.toHaveProperty('chapters')
    expect(exported).toMatchObject({ baseKnowledgeLibraryId: 'kp-id', baseKnowledgeLibraryCode: 'kp_json', baseKnowledgeLibraryName: '知识点库' })
    expect(exported.groups[0].tags[0]).toMatchObject({ description: '方法说明', appliesTo: ['单选题'], sortOrder: 1 })
  })

  it.each([
    { code: 'missing_type', name: '缺少类型', subject: '数学', stage: 'high_school', chapters: [] },
    { libraryType: 'method', code: 'wrong_type', name: '错误类型', subject: '数学', stage: 'high_school', chapters: [] },
    { libraryType: 'knowledge_point', code: 'wrong_shape', name: '错误结构', subject: '数学', stage: 'high_school', groups: [] },
  ])('rejects schema values that previously defaulted silently', (payload) => {
    expect(() => parseImportedLibrary(payload)).toThrow(/schema/)
  })

  it.each([
    { code: '***' },
    { baseKnowledgeLibraryId: 1 },
    { chapters: [{ code: 'CH_1', name: '第一章', sortOrder: '1', knowledgePoints: [{ code: 'KP_1', name: '集合' }] }] },
    { chapters: [{ code: 'CH_1', name: '第一章', knowledgePoints: [{ code: 'KP_1', name: '集合', description: 1 }] }] },
    { chapters: [{ code: 'CH_1', name: '第一章', knowledgePoints: [{ code: 'KP_1', name: '集合', sortOrder: Number.NaN }] }] },
    { chapters: [{ code: 'CH_1', name: '第一章', knowledgePoints: [{ code: 'KP_1', name: '集合', appliesTo: ['单选题', 1] }] }] },
  ])('rejects invalid shared field types', (override) => {
    const payload = {
      libraryType: 'knowledge_point', code: 'kp_json', name: '知识点库', subject: '数学', stage: 'high_school',
      chapters: [{ code: 'CH_1', name: '第一章', knowledgePoints: [{ code: 'KP_1', name: '集合' }] }],
      ...override,
    }
    expect(() => parseImportedLibrary(payload)).toThrow(/schema/)
  })

  it('rejects invalid method tag types', () => {
    expect(() => parseImportedLibrary({
      libraryType: 'method_tag', code: 'method_json', name: '方法库', subject: '数学', stage: 'high_school',
      groups: [{ code: 'MG_1', name: '方法分组', tags: [{ code: 'MT_1', name: '换元', tagType: 'knowledge' }] }],
    })).toThrow(/schema/)
  })
})
