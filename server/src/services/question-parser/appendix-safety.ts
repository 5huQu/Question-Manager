import type { ImportFlowV2ParserConfig } from './default-parser-config.js'
import { detectQuestionNumbers } from './question-number-detector.js'
import { splitMarkdownByQuestionNumbers } from './markdown-question-splitter.js'
import { splitQuestionFields } from './solution-matcher.js'
import { maskStructuralText } from './structural-detection.js'

function visibleText(value: string) {
  return String(value || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function looksLikeFullQuestionStem(value: string, hasInlineSolutionFields: boolean) {
  const stem = visibleText(value)
  if (stem.length < 24) return false
  if (hasInlineSolutionFields) return true
  return stem.length >= 72 && /(?:如图|已知|下列|若|求证|证明|求\s|求出|选择|填入|判断|___|（\s*）|\(\s*\))/u.test(stem.slice(0, 240))
}

/**
 * A global appendix split must not discard another substantial run of full
 * questions. OCR may emit a local “解析:” field as a standalone heading, so
 * heading text alone is never sufficient evidence for truncating the source.
 */
export function appendixSplitLeavesQuestionContent(
  markdown: string,
  solutionStart: number,
  config: ImportFlowV2ParserConfig,
) {
  const tail = String(markdown || '').slice(solutionStart)
  const matches = detectQuestionNumbers(tail, config)
  if (matches.length < 3) return false
  const chunks = splitMarkdownByQuestionNumbers(tail, matches)
  const questionLikeCount = chunks.filter((chunk) => {
    const fields = splitQuestionFields(maskStructuralText(chunk.body, config), solutionStart + chunk.contentStart)
    return looksLikeFullQuestionStem(fields.stemMarkdown, Boolean(fields.answerRange || fields.analysisRange))
  }).length
  return questionLikeCount >= 3 && questionLikeCount / chunks.length >= 0.25
}
