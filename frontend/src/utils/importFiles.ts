const sourceDocumentExtensions = new Set(['.pdf', '.jpg', '.jpeg', '.png'])

export function unsupportedImportReason(name: string, options: { allowJson?: boolean } = {}) {
  const extension = name.trim().toLowerCase().match(/\.[^.]+$/)?.[0] || ''
  if (extension === '.doc' || extension === '.docx') {
    return '暂不支持 Word 文件。请先将 DOC/DOCX 另存为 PDF 后上传。'
  }
  if (options.allowJson && extension === '.json') return ''
  if (!sourceDocumentExtensions.has(extension)) {
    return '暂不支持该文件格式，请上传 PDF、JPG、JPEG 或 PNG 文件。'
  }
  return ''
}
