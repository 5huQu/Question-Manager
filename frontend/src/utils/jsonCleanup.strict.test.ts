import { describe, expect, it } from 'vitest'
import { parseStrictQuestionsFromJsonText } from './jsonCleanup'

describe('parseStrictQuestionsFromJsonText', () => {
  it('parses a standard question payload without rewriting it', () => {
    const text = '{"questions":[{"questionNo":"1","problemText":"求 $x$","answerText":"1"}]}'
    const result = parseStrictQuestionsFromJsonText(text)

    expect(result.questions).toHaveLength(1)
    expect(result.previews[0]).toMatchObject({ questionNo: '1', problemText: '求 $x$', answerText: '1' })
  })

  it.each([
    ['markdown fence', '```json\n{"questions": []}\n```'],
    ['trailing comma', '{"questions": [],}'],
    ['multiple payloads', '{"questions": []}\n{"questions": []}'],
    ['unescaped latex backslash', '{"questions":[{"problemText":"$\\alpha$"}]}'],
  ])('rejects %s instead of cleaning it', (_label, text) => {
    expect(() => parseStrictQuestionsFromJsonText(text)).toThrow()
  })
})
