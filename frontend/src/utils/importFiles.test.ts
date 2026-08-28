import { describe, expect, it } from 'vitest'
import { parseOcrDocumentJsonFile, unsupportedImportReason } from './importFiles'

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

describe('parseOcrDocumentJsonFile', () => {
  it('reads a strict JSON object instead of treating it as a binary upload', async () => {
    const file = new File(['{"provider":"doc2x","markdown":"题干","pages":[],"assets":[]}'], 'ocr.json', { type: 'application/json' })
    await expect(parseOcrDocumentJsonFile(file)).resolves.toMatchObject({ provider: 'doc2x' })
  })

  it('rejects malformed JSON and non-object roots', async () => {
    await expect(parseOcrDocumentJsonFile(new File(['{'], 'bad.json'))).rejects.toThrow(/严格合法/)
    await expect(parseOcrDocumentJsonFile(new File(['[]'], 'array.json'))).rejects.toThrow(/顶层必须是对象/)
  })
})
