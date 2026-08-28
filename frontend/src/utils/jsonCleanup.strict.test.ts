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
    ['snake case aliases', '{"questionNo":"1","problem_text":"题干","answer":"A","analysis":"解析"}'],
    ['canonical markdown aliases', '{"questionNo":"1","stemMarkdown":"题干","answerText":"A","analysisMarkdown":"解析"}'],
    ['legacy camel case aliases', '{"questionNo":"1","problemText":"题干","answerText":"A","analysisText":"解析"}'],
  ])('accepts supported %s', (_label, text) => {
    expect(parseStrictQuestionsFromJsonText(text).previews[0]).toMatchObject({ problemText: '题干', answerText: 'A', analysisText: '解析' })
  })

  it.each([
    ['missing stem', '{"answer":"A"}'],
    ['empty stem', '{"problem_text":"   "}'],
    ['null question', '{"questions":[null]}'],
    ['wrong stem type', '{"problemText":{}}'],
  ])('rejects schema-invalid %s', (_label, text) => {
    expect(() => parseStrictQuestionsFromJsonText(text)).toThrow(/schema/)
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
