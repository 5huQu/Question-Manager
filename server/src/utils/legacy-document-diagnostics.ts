/**
 * Read-only compatibility for diagnostics stored by the retired Word import
 * path. This module intentionally does not inspect files or invoke a
 * conversion tool; it only formats fields already present in old records.
 */
export function buildDocumentDiagnosticMessage(diagnostics: Record<string, any>) {
  const docxClassification = diagnostics.docxFormulaAnalysis?.classification
  const graphics = diagnostics.cutDiagnostics?.graphics ?? diagnostics.graphics
  const hiddenCount = Number(graphics?.hidden_inline_formula_images || 0)
  const keptCount = Number(graphics?.kept_figure_candidates || 0)
  const formulaImageDocument = Boolean(graphics?.formula_image_document)

  if (docxClassification === 'image_or_ole_formula') {
    return '检测到 Word 中存在图片/OLE 型公式；切题时会自动隐藏疑似公式图片，只保留更像题图的候选框。'
  }
  if (formulaImageDocument || hiddenCount >= 8) {
    return `检测到 ${hiddenCount} 个疑似图片型公式块，已从题图候选中隐藏；保留 ${keptCount} 个图形候选。`
  }
  if (docxClassification === 'mixed_formula') {
    return '检测到 Word 公式结构混合，建议复核题图候选；系统已优先过滤行内公式图片。'
  }
  return ''
}
