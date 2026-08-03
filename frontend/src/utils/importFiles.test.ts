import { describe, expect, it } from 'vitest'
import { unsupportedImportReason } from './importFiles'

describe('unsupportedImportReason', () => {
  it('explains how to handle Word files', () => {
    expect(unsupportedImportReason('试卷.DOC')).toBe('暂不支持 Word 文件。请先将 DOC/DOCX 另存为 PDF 后上传。')
    expect(unsupportedImportReason('答案.docx')).toBe('暂不支持 Word 文件。请先将 DOC/DOCX 另存为 PDF 后上传。')
  })

  it('accepts supported source formats', () => {
    for (const name of ['paper.pdf', 'paper.JPG', 'paper.jpeg', 'paper.png']) {
      expect(unsupportedImportReason(name)).toBe('')
    }
  })
})
