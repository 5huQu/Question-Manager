export interface QuestionContentDraft {
  stemMarkdown: string
  answerText: string
  analysisMarkdown: string
}
export interface EditorTextNode {
  type: 'text'
  text: string
}

export interface EditorHardBreakNode {
  type: 'hardBreak'
}

export interface EditorInlineMathNode {
  type: 'inlineMath'
  latex: string
}

export type EditorInlineNode = EditorTextNode | EditorHardBreakNode | EditorInlineMathNode

export interface EditorParagraphNode {
  type: 'paragraph'
  content: EditorInlineNode[]
}

export interface EditorBlockMathNode {
  type: 'blockMath'
  latex: string
}

export interface EditorChoiceOption {
  label: 'A' | 'B' | 'C' | 'D'
  content: EditorInlineNode[]
}

export interface EditorChoicesNode {
  type: 'choices'
  options: EditorChoiceOption[]
}

export interface EditorTableCell {
  content: EditorInlineNode[]
}

export interface EditorTableNode {
  type: 'table'
  header: EditorTableCell[]
  rows: EditorTableCell[][]
  alignments: Array<'left' | 'center' | 'right' | null>
}

export interface EditorRawMarkdownNode {
  type: 'rawMarkdown'
  markdown: string
  reason: 'unsupported-markdown' | 'unsafe-html-removed'
}

export type EditorBlockNode =
  | EditorParagraphNode
  | EditorBlockMathNode
  | EditorChoicesNode
  | EditorTableNode
  | EditorRawMarkdownNode

export interface EditorCodecWarning {
  code: 'unsupported-markdown' | 'unsafe-html-removed'
  message: string
  blockIndex: number
}

export interface EditorDocumentV1 {
  version: 1
  content: EditorBlockNode[]
  warnings: EditorCodecWarning[]
}
