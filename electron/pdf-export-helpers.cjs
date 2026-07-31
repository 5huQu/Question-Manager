'use strict'

/**
 * PDF 导出纯逻辑辅助模块。
 * 不依赖 electron，可在 Node 中直接 require 进行可执行测试。
 */

/** 合法的纸张尺寸枚举。 */
const PAPER_SIZES = new Set(['A3', 'A4', 'custom'])
/** 合法的纸张方向枚举。 */
const PAPER_ORIENTATIONS = new Set(['portrait', 'landscape'])
/** 合法的教学文档导出版本。 */
const EXPORT_VARIANTS = new Set(['student', 'teacher'])

/**
 * 判断纸张数值字段是否可用（有限正数）。
 * @param {unknown} value
 * @returns {boolean}
 */
function isPositiveMm(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * 校验 PDF 导出请求参数。合法时返回 null，否则返回中文错误消息。
 * - documentId 必须为非空字符串；
 * - revision/pageCount 如提供必须为非负整数；
 * - title 如提供必须为字符串；
 * - variant 如提供必须为 student 或 teacher；
 * - paper 如提供必须为合法的纸张规格（size/orientation 枚举 + 正数宽高）。
 * @param {{documentId?: unknown, revision?: unknown, pageCount?: unknown, title?: unknown, variant?: unknown, paper?: unknown}} options
 * @returns {string | null}
 */
function validatePdfExportOptions(options) {
  const { documentId, revision, pageCount, title, variant, paper } = options || {}
  if (typeof documentId !== 'string' || documentId.trim() === '') {
    return '缺少文档 ID。'
  }
  if (revision !== undefined && revision !== null && (!Number.isInteger(revision) || revision < 0)) {
    return 'revision 参数无效。'
  }
  if (pageCount !== undefined && pageCount !== null && (!Number.isInteger(pageCount) || pageCount < 0)) {
    return 'pageCount 参数无效。'
  }
  if (title !== undefined && title !== null && typeof title !== 'string') {
    return 'title 参数无效。'
  }
  if (variant !== undefined && variant !== null && !EXPORT_VARIANTS.has(variant)) {
    return '导出版本无效。'
  }
  if (paper !== undefined && paper !== null) {
    if (typeof paper !== 'object' || Array.isArray(paper)) {
      return 'paper 参数无效。'
    }
    if (paper.size !== undefined && paper.size !== null && !PAPER_SIZES.has(paper.size)) {
      return '纸张尺寸无效。'
    }
    if (paper.orientation !== undefined && paper.orientation !== null && !PAPER_ORIENTATIONS.has(paper.orientation)) {
      return '纸张方向无效。'
    }
    if (paper.widthMm !== undefined && paper.widthMm !== null && !isPositiveMm(paper.widthMm)) {
      return '纸张宽度无效。'
    }
    if (paper.heightMm !== undefined && paper.heightMm !== null && !isPositiveMm(paper.heightMm)) {
      return '纸张高度无效。'
    }
  }
  return null
}

/**
 * 根据文档纸张生成 webContents.printToPDF 参数。
 *
 * 关键约定：
 * - PaperSpec 的 widthMm/heightMm 已经包含方向语义（landscape 时宽>高），
 *   因此直接以物理尺寸生成自定义 pageSize，绝不按 A4 硬编码，也不二次旋转。
 * - preferCSSPageSize 保持为 true：打印页通过 @page { size: var(--td-page-size) }
 *   声明与文档一致的纸张，作为 MediaBox 的首要来源；此处生成的 pageSize 作为
 *   受控回退，两者由同一 PaperSpec 派生，保证 PDF MediaBox 与文档纸张一致。
 * - marginsType: 1（无边距）：页边距由纸张内容区（PaperSpec margins）控制，
 *   绝不交由 Chromium 页边距处理，避免双重边距。
 * - paper 缺失或宽高无效时不硬编码 A4，仅依赖打印页 CSS @page 尺寸。
 * @param {{size?: string, orientation?: string, widthMm?: number, heightMm?: number} | null | undefined} paper
 * @returns {object} printToPDF 参数
 */
function buildPrintToPDFOptions(paper) {
  const base = {
    marginsType: 1,
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: false,
  }
  const widthMm = paper ? Number(paper.widthMm) : NaN
  const heightMm = paper ? Number(paper.heightMm) : NaN
  if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm) || widthMm <= 0 || heightMm <= 0) {
    return base
  }
  // Electron 自定义 pageSize 使用英寸；物理尺寸已含方向，landscape 不再二次旋转。
  return {
    ...base,
    pageSize: { width: widthMm / 25.4, height: heightMm / 25.4 },
    landscape: false,
  }
}

/**
 * 基于 canonical app origin 构造打印页 URL（BrowserRouter 真实路径，非 hash）。
 * 绝不从 process.argv / process.env.PORT 推断地址：origin 必须由调用方传入
 * （来自主进程 createWindow 已启动服务的真实端口）。
 * 如提供 paper，则将其 JSON 序列化后附加为 paper 查询参数，供打印页交叉校验
 * 文档纸张与导出期望纸张是否一致。
 * @param {string} appOrigin createWindow 已启动服务的 canonical origin
 * @param {string} documentId
 * @param {number} [revision]
 * @param {object} [paper] 文档纸张规格（PaperSpec）
 * @param {'student'|'teacher'} [variant] 教学文档导出版本
 * @returns {string}
 */
function buildPrintUrl(appOrigin, documentId, revision, paper, variant) {
  let url = `${appOrigin}/print/teaching-document?docId=${encodeURIComponent(documentId)}&revision=${encodeURIComponent(String(revision ?? 0))}`
  if (paper && typeof paper === 'object') {
    url += `&paper=${encodeURIComponent(JSON.stringify(paper))}`
  }
  if (variant === 'student' || variant === 'teacher') {
    url += `&variant=${encodeURIComponent(variant)}`
  }
  return url
}

module.exports = { validatePdfExportOptions, buildPrintToPDFOptions, buildPrintUrl }
