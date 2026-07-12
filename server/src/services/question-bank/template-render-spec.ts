export const templateRenderSpecVersion = 1 as const

export type TemplateRenderSpec = {
  version: typeof templateRenderSpecVersion
  templateId: 'exam' | 'worksheet'
  page: { widthMm: number; heightMm: number; marginTopMm: number; marginRightMm: number; marginBottomMm: number; marginLeftMm: number }
  typography: { bodyFont: string; headingFont: string; bodySizePt: number; lineHeight: number; questionGapMm: number }
  header: { heightMm: number; label: string; subject: string }
  footer: { heightMm: number }
  title: { sizePt: number; gapAfterMm: number }
  section: { sizePt: number; gapBeforeMm: number; gapAfterMm: number }
  choices: { columnGapMm: number; rowGapMm: number }
  figures: { maxHeightMm: number; defaultWidthRatio: number; sideWidthRatio: number }
  colors: { ink: string; tint: string; line: string; warm: string; alert: string }
}

const shared = {
  version: templateRenderSpecVersion,
  page: { widthMm: 210, heightMm: 297, marginTopMm: 20, marginRightMm: 20, marginBottomMm: 20, marginLeftMm: 20 },
  typography: { bodyFont: 'Songti SC, SimSun, serif', headingFont: 'PingFang SC, Heiti SC, sans-serif', bodySizePt: 11, lineHeight: 1.16, questionGapMm: 2.6 },
  header: { heightMm: 10, label: '', subject: '高中数学' },
  footer: { heightMm: 8 },
  title: { sizePt: 18, gapAfterMm: 4 },
  section: { sizePt: 14, gapBeforeMm: 4, gapAfterMm: 3 },
  choices: { columnGapMm: 4, rowGapMm: 1.5 },
  figures: { maxHeightMm: 42, defaultWidthRatio: .45, sideWidthRatio: .4 },
  colors: { ink: '#1B3A5B', tint: '#EEF3F8', line: '#C9D3DC', warm: '#A8762B', alert: '#A23B2D' },
}

export function templateRenderSpec(templateId: unknown): TemplateRenderSpec {
  const id = templateId === 'exam' ? 'exam' : 'worksheet'
  return { ...shared, templateId: id, header: { ...shared.header, label: id === 'exam' ? '试卷' : '练习单' } }
}
