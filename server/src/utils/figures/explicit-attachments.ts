export function bindExplicitAttachments(
  result: Record<string, any>,
  localFigures: Array<Record<string, any>>
) {
  const fields: Array<'problem_text' | 'answer' | 'analysis'> = ['problem_text', 'answer', 'analysis']

  for (const figure of localFigures) {
    if (!figure.ocrBinding?.enabled || !figure.ocrBinding?.attachmentId) {
      continue
    }
    const attachmentId = String(figure.ocrBinding.attachmentId)
    // Match the literal protocol token emitted by OCR, e.g. {{figure:F1}}.
    // Attachment IDs are generated internally today, but escaping keeps this
    // safe if a future provider uses a different identifier format.
    const escapedAttachmentId = attachmentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`\\{\\{\\s*figure\\s*:\\s*${escapedAttachmentId}\\s*\\}\\}`, 'gi')

    let found = false
    for (const field of fields) {
      const text = String(result[field] || '')
      if (pattern.test(text)) {
        found = true
        const blockId = `cut_inline_${figure.usage || 'stem'}_${attachmentId}`
        figure.blockId = blockId
        figure.ocrBinding = {
          ...figure.ocrBinding,
          status: 'bound'
        }
        result[field] = text.replace(pattern, `\n\n<!-- DOC2X_FIGURE:${blockId} -->\n\n`)
      }
    }

    if (!found) {
      // 如果它之前被标为 bound 且并没有被匹配（比如文本中已被用户手动挪去，且没找到当前匹配），
      // 我们在导入时将其设定为 unplaced
      if (figure.ocrBinding.status !== 'ignored') {
        figure.ocrBinding = {
          ...figure.ocrBinding,
          status: 'unplaced'
        }
      }
    }
  }
}
