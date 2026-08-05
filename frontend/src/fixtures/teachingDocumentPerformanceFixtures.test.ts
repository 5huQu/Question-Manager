import { describe, expect, it } from 'vitest'
import {
  createTeachingDocumentPerformanceFixture,
  TEACHING_DOCUMENT_PERFORMANCE_FIXTURES,
} from './teachingDocumentPerformanceFixtures'

describe('teaching document performance fixtures', () => {
  it.each([
    ['small', 30, 10],
    ['medium', 100, 40],
    ['large', 300, 100],
  ] as const)('creates the %s fixture with deterministic block and question counts', (size, blocks, questions) => {
    const fixture = TEACHING_DOCUMENT_PERFORMANCE_FIXTURES[size]
    expect(fixture.content).toHaveLength(blocks)
    expect(fixture.content.filter((block) => block.type === 'question')).toHaveLength(questions)
    expect(new Set(fixture.content.map((block) => block.id)).size).toBe(blocks)
    expect(createTeachingDocumentPerformanceFixture(size)).toEqual(fixture)
  })

  it('covers the layout-sensitive block families in the large fixture', () => {
    const types = new Set(TEACHING_DOCUMENT_PERFORMANCE_FIXTURES.large.content.map((block) => block.type))
    expect(types).toEqual(expect.objectContaining(new Set([
      'heading',
      'paragraph',
      'question',
      'box',
      'figure',
      'rawMarkdown',
      'pageBreak',
    ])))
  })
})
