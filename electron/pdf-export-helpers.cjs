'use strict'

/**
 * PDF 导出纯逻辑辅助模块。
 * 不依赖 electron，可在 Node 中直接 require 进行可执行测试。
 */

/**
 * 校验 PDF 导出请求参数。合法时返回 null，否则返回中文错误消息。
 * - documentId 必须为非空字符串；
 * - revision/pageCount 如提供必须为非负整数；
 * - title 如提供必须为字符串。
 * @param {{documentId?: unknown, revision?: unknown, pageCount?: unknown, title?: unknown}} options
 * @returns {string | null}
 */
function validatePdfExportOptions(options) {
  const { documentId, revision, pageCount, title } = options || {}
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
  return null
}

/**
 * 基于 canonical app origin 构造打印页 URL（BrowserRouter 真实路径，非 hash）。
 * 绝不从 process.argv / process.env.PORT 推断地址：origin 必须由调用方传入
 * （来自主进程 createWindow 已启动服务的真实端口）。
 * @param {string} appOrigin createWindow 已启动服务的 canonical origin
 * @param {string} documentId
 * @param {number} [revision]
 * @returns {string}
 */
function buildPrintUrl(appOrigin, documentId, revision) {
  return `${appOrigin}/print/teaching-document?docId=${encodeURIComponent(documentId)}&revision=${encodeURIComponent(String(revision ?? 0))}`
}

module.exports = { validatePdfExportOptions, buildPrintUrl }
