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

export async function parseOcrDocumentJsonFile(file: File): Promise<Record<string, unknown>> {
  let value: unknown
  try {
    value = JSON.parse(await file.text())
  } catch {
    throw new Error('OCRDocument JSON 文件不是严格合法的 JSON。')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('OCRDocument JSON 文件顶层必须是对象。')
  }
  return value as Record<string, unknown>
}
