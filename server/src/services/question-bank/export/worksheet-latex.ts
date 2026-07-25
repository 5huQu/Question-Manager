import fs from 'node:fs'
import path from 'node:path'
import { safeName } from '../../../utils/ids.js'
import { normalizeQuestionType } from '../../../utils/question-type.js'
import {
  latexWithInlineFigures,
  questionFigures,
  analysisFigures,
  figuresWithoutInlineMarkers,
  doc2xInlineFigureIds,
  figuresByIdentifier,
} from '../../../utils/figure-export.js'
import { markdownToExamLatex as richMarkdownToExamLatex } from '../../../utils/rich-content.js'
import {
  worksheetFigureWidthLimits,
  worksheetFigureId,
  worksheetAnswerLatex,
  worksheetEntryKey,
  buildWorksheetScorePlan,
  worksheetSectionTitle,
  qbankChoiceLayout,
  decideWorksheetFigureLayout,
  WorksheetFigureSpec,
} from '../../../utils/worksheet-figures.js'
import {
  renderExamZhPrompt,
  splitChoiceStemForExport,
} from '../../../utils/exam-zh.js'
import { readAppSettings } from '../../settings/app-settings.js'
import { resolveStoragePath } from '../../../utils/paths.js'
import { stripAssetPrefix } from '../../../utils/ocr-helpers.js'
import { templateRenderSpec } from '../template-render-spec.js'
import { figureLayoutFor, questionLayoutFor } from '../paper-layout.js'
import type { PaperLayoutDraft, QuestionLayout, ChoiceLayoutOverride, LayoutWarning } from '../paper-layout.js'
import type { ExportCollection, StandardExportVariant } from './types.js'

const DOC2X_FIGURE_MARKER_RE = /<!--\s*DOC2X_FIGURE:([^>\s]+)\s*-->/g

function figureAbsolutePath(figure: Record<string, any>) {
  const rawPath = stripAssetPrefix(String(figure.path || figure.sourcePath || ''))
  if (!rawPath) return ''
  return path.isAbsolute(rawPath) ? rawPath : resolveStoragePath(rawPath)
}

function markdownToExamLatex(value: string, preserveBreaks = true) {
  const text = String(value || '')
    .replace(/【解析】/g, '')
    .replace(/【分析】/g, '')
    .replace(/【详解】/g, '')
    .replace(/详解】/g, '')
    .trim()
  return richMarkdownToExamLatex(text, preserveBreaks)
}

export function buildCollectionWorksheetLatex(
  collection: ExportCollection,
  variant: StandardExportVariant,
  figuresDir: string,
  adjustments: Map<string, number>,
  documentClass = 'qbank-worksheet',
  layoutDraft?: PaperLayoutDraft,
) {
  const renderSpec = templateRenderSpec(documentClass === 'qbank-exam' ? 'exam' : 'worksheet')
  const specs = new Map<string, WorksheetFigureSpec>()
  const warnings: LayoutWarning[] = []
  const scorePlan = buildWorksheetScorePlan(collection as any)
  const appSettings = readAppSettings()
  const brandName =
    documentClass === 'qbank-lecture'
      ? appSettings.lectureWatermark
      : documentClass === 'qbank-exam'
        ? appSettings.examWatermark
        : appSettings.worksheetWatermark
  const brandTagline = `${brandName} ｜ 高中数学`
  const lines = [
    `\\documentclass{${documentClass}}`,
    `\\geometry{a4paper,top=${renderSpec.page.marginTopMm}mm,bottom=${renderSpec.page.marginBottomMm}mm,left=${renderSpec.page.marginLeftMm}mm,right=${renderSpec.page.marginRightMm}mm,headheight=26pt,headsep=10pt,footskip=22pt}`,
    `\\setlength{\\parskip}{${renderSpec.typography.questionGapMm.toFixed(1)}mm}`,
    `\\setbrandname{${markdownToExamLatex(brandName, false)}}`,
    '\\setbrandmark{Q}',
    `\\setbrandtagline{${markdownToExamLatex(brandTagline, false)}}`,
    '\\setsubject{高中数学}',
    `\\doctitle{${markdownToExamLatex(collection.title || '综合练习', false)}}`,
  ]
  lines.push('\\begin{document}', '\\qbankmaketitle')
  let currentSection = ''
  const layoutOrder=new Map((layoutDraft?.questions||[]).map((item,index)=>[item.relationId,item.order??index]))
  const orderedQuestions=collection.questions.map((entry,index)=>({entry,index})).sort((left,right)=>(layoutOrder.get(String(left.entry.relationId||left.entry.item?.id))??left.index)-(layoutOrder.get(String(right.entry.relationId||right.entry.item?.id))??right.index)).map(item=>item.entry)
  orderedQuestions.forEach((entry, index) => {
    const key = worksheetEntryKey(entry, index)
    const sectionName = scorePlan.entrySections.get(key) || ''
    const questionLayout = questionLayoutFor(layoutDraft, entry.relationId || entry.item?.id)
    if ((questionLayout?.pageBreakBefore || questionLayout?.equalizedPageBreakBefore) && index > 0) lines.push('\\newpage')
    if (sectionName && sectionName !== currentSection) {
      currentSection = sectionName
      lines.push(
        `\\examsectionstart{${markdownToExamLatex(
          worksheetSectionTitle(currentSection, scorePlan.sectionScores.get(currentSection)),
          false,
        )}}`,
      )
    }
    if (!(questionLayout?.pageBreakBefore || questionLayout?.equalizedPageBreakBefore) && questionLayout?.keepTogether !== false) lines.push('\\Needspace{8\\baselineskip}')
    lines.push(worksheetQuestionLatex(entry, index, variant, collection.id, figuresDir, adjustments, specs, questionLayout, warnings))
  })
  lines.push('\\end{document}', '')
  return { content: lines.join('\n\n'), specs, warnings }
}

function worksheetQuestionLatex(
  entry: any,
  index: number,
  variant: StandardExportVariant,
  collectionId: string,
  figuresDir: string,
  adjustments: Map<string, number>,
  specs: Map<string, WorksheetFigureSpec>,
  layout?: QuestionLayout,
  warnings: LayoutWarning[] = [],
) {
  const questionId = safeName(String(entry.relationId || entry.item?.id || index + 1))
  const lines = [`\\begin{examquestion}{${index + 1}}{${questionId}}`]
  const stemFigures = questionFigures(entry)
  const stemForLayout = moveTrailingStemFigureBeforeChoices(entry.item.stemMarkdown, stemFigures)
  const { prompt, choices, trailingContent } = splitChoiceStemForExport(stemForLayout)
  const boundaryMarker = choices.length > 0 && doc2xInlineFigureIds(prompt).size === 1
    ? prompt.match(/<!--\s*DOC2X_FIGURE:([^>\s]+)\s*-->\s*$/)
    : null
  const boundaryFigure = boundaryMarker ? figuresByIdentifier(stemFigures).get(boundaryMarker[1]) : undefined
  const promptForLayout = boundaryMarker ? prompt.slice(0, boundaryMarker.index).trim() : prompt
  const registerFigure = (figure: Record<string, any>, figureIndex: number, usage: string, requestedWidth?: number) => {
      const sourcePath = figureAbsolutePath(figure)
      if (!sourcePath || !fs.existsSync(sourcePath)) {
        warnings.push({ code: 'missing-figure', questionId, figureId: String(figure.id || figure.blockId || figureIndex + 1), message: '题目引用的图片文件不存在。', suggestion: '请重新绑定或上传图片后再导出。' })
        return ''
      }
      const extension = path.extname(sourcePath).toLowerCase() || '.png'
      const figureId = worksheetFigureId(collectionId, entry, figure, figureIndex, usage)
      const outputName = `${safeName(`q${entry.item.serialNo || index + 1}-${figure.id || figureIndex + 1}`)}${extension}`
      const outputPath = path.join(figuresDir, outputName)
      if (!fs.existsSync(outputPath)) fs.copyFileSync(sourcePath, outputPath)
      const limits = worksheetFigureWidthLimits(sourcePath)
      specs.set(figureId, { id: figureId, sourcePath, outputName, ...limits })
      const width = requestedWidth ?? adjustments.get(figureId) ?? limits.defaultWidth
      const alignment=figureLayoutFor(layout,figure)?.alignment||'center'
      return `\\qbankfigure{${figureId}}{${width.toFixed(4)}}{${alignment}}{figures/${outputName}}`
  }
  const appendFigures = (figures: Array<Record<string, any>>, usage: string) => {
    const rendered = figures.flatMap((figure, figureIndex) => {
      const latex = registerFigure(figure, figureIndex, usage, figureLayoutFor(layout, figure)?.widthRatio)
      return latex ? [latex] : []
    })
    const mode = layout?.multiFigureLayout || 'auto'
    if (rendered.length >= 2 && rendered.length <= 4 && mode !== 'column') lines.push(worksheetFigureGridLatex(rendered))
    else lines.push(...rendered)
  }

  const figuresWithoutMarkers = figuresWithoutInlineMarkers(stemForLayout, stemFigures)
  const unanchoredStemFigures = figuresWithoutMarkers.filter((figure) => String(figure.usage || 'stem') !== 'options')
  const sideFigure = unanchoredStemFigures.length === 1
    ? unanchoredStemFigures[0]
    : unanchoredStemFigures.length === 0 && boundaryFigure
      ? boundaryFigure
      : undefined
  const sideDecision = sideFigure ? decideWorksheetFigureLayout({
    questionId,
    figureId: String(sideFigure.id || sideFigure.blockId || 'figure'),
    imagePath: figureAbsolutePath(sideFigure),
    stemFigureCount: 1,
    hasInlineMarker: false,
    choices,
    requested: figureLayoutFor(layout, sideFigure),
  }) : undefined
  if (sideDecision) warnings.push(...sideDecision.warnings)
  const explicitWideChoices = layout?.choiceLayout === 'four' || layout?.choiceLayout === 'two'
  const useSideLayout = Boolean(
    sideFigure && sideDecision &&
    (sideDecision.placement === 'side-left' || sideDecision.placement === 'side-right') &&
    (sideDecision.source === 'manual' || !explicitWideChoices),
  )
  if (useSideLayout && layout?.keepTogether !== false) lines.unshift('\\Needspace{16\\baselineskip}')
  const promptLatex = compactWorksheetFigureRuns(keepSubquestionsTogether(
    worksheetPromptWithInlineFigures(
      promptForLayout || entry.item.stemMarkdown,
      stemFigures,
      entry.item.questionType,
      (figure) => registerFigure(figure, Math.max(0, stemFigures.indexOf(figure)), 'stem'),
    ) || '（题干待补充）',
  ), layout?.multiFigureLayout)
  lines.push(promptLatex)

  if (useSideLayout && sideFigure && sideDecision) {
    const figureLatex = registerFigure(sideFigure, Math.max(0, stemFigures.indexOf(sideFigure)), 'stem', 0.95)
    if (figureLatex) {
      lines.push(`\\qbankchoiceswithfigure{${sideDecision.placement === 'side-left' ? 'left' : 'right'}}{${sideDecision.widthRatio.toFixed(2)}}{${figureLatex}}{${worksheetChoicesLatex(choices, stemFigures, 'one', layout)}}`)
    } else {
      lines.push(worksheetChoicesLatex(choices, stemFigures, layout?.choiceLayout, layout))
    }
  } else {
    const keepFigureWithChoices = unanchoredStemFigures.length === 1 && choices.length === 4
    if (keepFigureWithChoices) lines.push('\\begin{samepage}')
    appendFigures(unanchoredStemFigures.filter((figure) => {
      const placement = figureLayoutFor(layout, figure)?.placement
      return placement !== 'after-choices'
    }), 'stem')
    if (choices.length) {
      if (layout?.choiceLayout === 'four' && qbankChoiceLayout(choices) !== 'four') warnings.push({ code: 'choice-overflow', questionId, message: '选项内容不适合强制四栏，可能超出栏宽。', suggestion: '改为自动、两栏或单栏布局。' })
      lines.push(worksheetChoicesLatex(choices, stemFigures, layout?.choiceLayout))
    }
    if (trailingContent) {
      lines.push(compactWorksheetFigureRuns(keepSubquestionsTogether(
        worksheetMarkdownWithInlineFigures(trailingContent, stemFigures, true, false, (figure) =>
          registerFigure(figure, Math.max(0, stemFigures.indexOf(figure)), 'stem'),
        ),
      ), layout?.multiFigureLayout))
    }
    if (keepFigureWithChoices) lines.push('\\end{samepage}')
    appendFigures(unanchoredStemFigures.filter((figure) => figureLayoutFor(layout, figure)?.placement === 'after-choices'), 'stem')
  }
  appendFigures(
    figuresWithoutMarkers.filter((figure) => String(figure.usage || '') === 'options'),
    'options',
  )
  if (variant === 'teacher') {
    const solutionFigures = analysisFigures(entry)
    lines.push('\\begin{solutionbox}')
    const renderSolutionFigure = (figure: Record<string, any>) =>
      registerFigure(figure, Math.max(0, solutionFigures.indexOf(figure)), 'analysis')
    lines.push(`\\anslabel ${worksheetMarkdownWithInlineFigures(entry.item.answerText, solutionFigures, true, true, renderSolutionFigure) || '暂无'}\\par`)
    lines.push(`\\sollabel ${worksheetMarkdownWithInlineFigures(entry.item.analysisMarkdown || '暂无', solutionFigures, true, false, renderSolutionFigure)}`)
    appendFigures(
      figuresWithoutInlineMarkers(
        `${entry.item.answerText || ''}\n${entry.item.analysisMarkdown || ''}`,
        solutionFigures,
      ),
      'analysis',
    )
    lines.push('\\end{solutionbox}')
  } else if (
    normalizeQuestionType(entry.item.questionType, entry.item.stemMarkdown, entry.item.answerText) === '解答题'
  ) {
    const answerAreaHeight = Math.min(Math.max(Number(layout?.answerAreaHeight ?? layout?.equalizedAnswerAreaHeight ?? 4.2), 0), 30)
    if (answerAreaHeight > 0) lines.push(`\\nobreak\\begin{answerarea}{${answerAreaHeight.toFixed(1)}cm}\\end{answerarea}`)
  }
  lines.push('\\end{examquestion}')
  return lines.join('\n')
}

/**
 * OCR providers commonly append a stem diagram after option D. Without this
 * normalization the choice splitter treats that marker as part of D, so the
 * diagram can never participate in the side-by-side stem layout.
 */
function moveTrailingStemFigureBeforeChoices(stem: string, figures: Array<Record<string, any>>) {
  const source=String(stem||'')
  const markerMatch=source.match(/(?:\r?\n\s*)+(<!--\s*DOC2X_FIGURE:([^>\s]+)\s*-->)\s*$/)
  if(!markerMatch?.index)return source
  const figure=figuresByIdentifier(figures).get(markerMatch[2])
  if(!figure||String(figure.usage||'stem')==='options')return source
  const withoutMarker=source.slice(0,markerMatch.index).trimEnd()
  const split=splitChoiceStemForExport(withoutMarker)
  if(split.choices.length!==4||split.trailingContent)return source
  return [split.prompt,markerMatch[1],...split.choices.map((choice,index)=>`${String.fromCharCode(65+index)}. ${choice}`)].join('\n')
}

function worksheetPromptWithInlineFigures(
  content: string,
  figures: Array<Record<string, any>>,
  questionType: string,
  renderFigure: (figure: Record<string, any>) => string,
) {
  return worksheetInlineFigureLatex(content, figures, (text) => renderExamZhPrompt(text, questionType), renderFigure)
}

function worksheetMarkdownWithInlineFigures(
  content: string,
  figures: Array<Record<string, any>>,
  preserveParagraphs = true,
  answer = false,
  renderFigure?: (figure: Record<string, any>) => string,
) {
  return worksheetInlineFigureLatex(
    content,
    figures,
    (text) => answer ? worksheetAnswerLatex(text) : markdownToExamLatex(text, preserveParagraphs),
    renderFigure,
  )
}

function worksheetInlineFigureLatex(
  content: string,
  figures: Array<Record<string, any>>,
  renderText: (text: string) => string,
  renderFigure?: (figure: Record<string, any>) => string,
) {
  const source = String(content || '')
  const figureById = figuresByIdentifier(figures)
  const lines: string[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  DOC2X_FIGURE_MARKER_RE.lastIndex = 0
  while ((match = DOC2X_FIGURE_MARKER_RE.exec(source))) {
    const text = source.slice(cursor, match.index).trim()
    if (text) lines.push(renderText(text))
    const figure = figureById.get(match[1])
    if (figure) {
      const latex = renderFigure?.(figure) || worksheetInlineFigureLines(figure).join('\n')
      if (latex) lines.push(latex)
    }
    cursor = match.index + match[0].length
  }
  const tail = source.slice(cursor).trim()
  if (tail) lines.push(renderText(tail))
  return lines.join('\n')
}

function compactWorksheetFigureRuns(latex: string, mode: QuestionLayout['multiFigureLayout'] = 'auto') {
  if (mode === 'column') return latex
  const item = String.raw`\\qbankfigure\{([^{}]+)\}\{([0-9.]+)\}\{(?:left|center|right)\}\{([^{}]+)\}\s*(?:\\par\s*)?((?:图\s*)?[甲乙丙丁戊己庚辛])`
  const run = new RegExp(`(?:${item}\\s*){2,}`, 'g')
  const labelled = String(latex || '').replace(run, (block) => {
    const matcher = new RegExp(item, 'g')
    const cells: string[] = []
    let match: RegExpExecArray | null
    while ((match = matcher.exec(block))) {
      cells.push(JSON.stringify({ id: match[1], width: Number(match[2]), path: match[3], label: match[4].replace(/\s+/g, '') }))
    }
    if (cells.length < 2) return block
    const columns = cells.length === 3 ? 3 : 2
    const cellWidth = columns === 3 ? 0.31 : 0.48
    const rendered = cells.map((cell) => {
      const parsed = JSON.parse(cell) as { id: string; width: number; path: string; label: string }
      const scale = Math.min(1, Math.max(0.3, parsed.width / cellWidth))
      return `\\qbankfiguregridcell{${parsed.id}}{${parsed.path}}{${parsed.label}}{${scale.toFixed(3)}}`
    })
    return `\\begin{qbankfiguregrid}{${columns}}\n${rendered.join('\n')}\n\\end{qbankfiguregrid}`
  })
  const plainItem = String.raw`\\qbankfigure\{[^{}]+\}\{[0-9.]+\}\{(?:left|center|right)\}\{[^{}]+\}`
  const plainRun = new RegExp(`(?:${plainItem}\\s*){2,4}`, 'g')
  return labelled.replace(plainRun, (block) => {
    const figures = block.match(new RegExp(plainItem, 'g')) || []
    return figures.length >= 2 ? worksheetFigureGridLatex(figures) : block
  })
}

function worksheetFigureGridLatex(figures: string[]) {
  const item = /\\qbankfigure\{([^{}]+)\}\{([0-9.]+)\}\{(?:left|center|right)\}\{([^{}]+)\}/
  const parsed = figures.flatMap((latex) => {
    const match = latex.match(item)
    return match ? [{ id: match[1], width: Number(match[2]), path: match[3] }] : []
  })
  if (parsed.length !== figures.length) return figures.join('\n')
  const columns = parsed.length === 3 ? 3 : 2
  const cellWidth = columns === 3 ? 0.31 : 0.48
  const cells = parsed.map((figure) => {
    const scale = Math.min(1, Math.max(0.3, figure.width / cellWidth))
    return `\\qbankfiguregridcell{${figure.id}}{${figure.path}}{}{${scale.toFixed(3)}}`
  })
  return `\\begin{qbankfiguregrid}{${columns}}\n${cells.join('\n')}\n\\end{qbankfiguregrid}`
}

function worksheetInlineFigureLines(figure: Record<string, any>) {
  const sourcePath = figureAbsolutePath(figure)
  if (!sourcePath || !fs.existsSync(sourcePath)) return []
  return [
    '\\begin{center}',
    `\\includegraphics[width=0.82\\linewidth]{\\detokenize{${sourcePath}}}`,
    '\\end{center}',
  ]
}

function worksheetChoicesLatex(choices: string[], figures: Array<Record<string, any>> = [], override: ChoiceLayoutOverride = 'auto', layout?: QuestionLayout) {
  const rendered = choices.map((choice) => worksheetChoiceLatex(choice, figures, layout))
  if (rendered.length === 4) {
    const choiceLayout = override === 'auto' ? qbankChoiceLayout(choices) : override
    if (choiceLayout === 'four')
      return `\\qbankchoicesfour{${rendered[0]}}{${rendered[1]}}{${rendered[2]}}{${rendered[3]}}`
    if (choiceLayout === 'two')
      return `\\qbankchoicestwo{${rendered[0]}}{${rendered[1]}}{${rendered[2]}}{${rendered[3]}}`
  }
  return ['\\begin{qbankchoicesone}', ...rendered.map((choice) => `\\item ${choice}`), '\\end{qbankchoicesone}'].join(
    '\n',
  )
}

/** Render an option marker inside its A/B/C/D cell instead of as a block below the question. */
function worksheetChoiceLatex(choice: string, figures: Array<Record<string, any>>, layout?: QuestionLayout) {
  const inlineIds = doc2xInlineFigureIds(choice)
  if (!inlineIds.size) return markdownToExamLatex(choice, true).replace(/\n+/g, ' ').trim()
  const figureById = figuresByIdentifier(figures)
  let cursor = 0
  let match: RegExpExecArray | null
  const parts: string[] = []
  DOC2X_FIGURE_MARKER_RE.lastIndex = 0
  while ((match = DOC2X_FIGURE_MARKER_RE.exec(choice))) {
    const text = choice.slice(cursor, match.index).trim()
    if (text) parts.push(markdownToExamLatex(text, true).replace(/\n+/g, ' ').trim())
    const figure = figureById.get(match[1])
    const sourcePath = figure ? figureAbsolutePath(figure) : ''
    if (sourcePath && fs.existsSync(sourcePath)) {
      const requested = figure ? figureLayoutFor(layout, figure)?.widthRatio : undefined
      const cellWidth = Math.min(1, Math.max(0.35, (requested ?? 0.3) / 0.48))
      parts.push(`\\includegraphics[width=${cellWidth.toFixed(3)}\\linewidth,height=2.8cm,keepaspectratio]{\\detokenize{${sourcePath}}}`)
    }
    cursor = match.index + match[0].length
  }
  const tail = choice.slice(cursor).trim()
  if (tail) parts.push(markdownToExamLatex(tail, true).replace(/\n+/g, ' ').trim())
  return parts.join(' ')
}

function keepSubquestionsTogether(latex: string) {
  return String(latex || '').replace(
    /\\par\s*\n(?=（(?:\d+|[ivxIVX]+|[一二三四五六七八九十]+)）)/g,
    '\\par\\nobreak\n',
  )
}
