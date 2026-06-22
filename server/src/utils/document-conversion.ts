import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pythonRoot } from '../config.js'
import { pythonCommand, pythonEnv } from '../services/settings/python.js'
import { firstExecutable, sofficePath } from '../services/settings/tools.js'

// ── Exported functions ──────────────────────────────────────────────────────

export function convertDocxToPdf(inputPath: string, outDir: string) {
  const soffice = sofficePath()
  if (!soffice) {
    throw new Error('未找到 LibreOffice/soffice，无法将 Word 转 PDF。')
  }
  execFileSync(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, inputPath], {
    cwd: outDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const expected = path.join(outDir, `${path.basename(inputPath, path.extname(inputPath))}.pdf`)
  if (!fs.existsSync(expected)) {
    const pdfs = fs.readdirSync(outDir).filter((name) => name.toLowerCase().endsWith('.pdf')).map((name) => path.join(outDir, name))
    if (pdfs.length) return pdfs[0]
    throw new Error('Word 转 PDF 完成后未找到输出 PDF。')
  }
  return expected
}

export function analyzeDocxFormulaTypes(inputPath: string) {
  const code = [
    'import json, sys',
    'from pathlib import Path',
    'from src.lab.word import analyze_docx_formula_types',
    'print(json.dumps(analyze_docx_formula_types(Path(sys.argv[1])), ensure_ascii=False))',
  ].join('\n')
  try {
    const output = execFileSync(pythonCommand(), ['-c', code, inputPath], {
      cwd: pythonRoot,
      env: pythonEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return JSON.parse(output) as Record<string, unknown>
  } catch (error) {
    return {
      supported: false,
      error: error instanceof Error ? error.message : String(error),
      recommendation: 'DOCX 公式结构检测失败，已继续按普通 Word 转 PDF 流程处理。',
    }
  }
}

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

export function mergeDiagnostics(base: Record<string, any>, next: Record<string, any>) {
  return {
    ...base,
    ...next,
    docxFormulaAnalysis: base.docxFormulaAnalysis,
    cutDiagnostics: next.cutDiagnostics ?? base.cutDiagnostics,
  }
}
