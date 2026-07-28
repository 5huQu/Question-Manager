'use strict'

/**
 * PDF 导出生命周期控制器（electron 无关）。
 *
 * 竞态安全设计（导出生命周期所有权）：
 * - 每次 start 创建确定性的 export context（token），窗口/保存路径/写入状态都挂在
 *   自己的 context 上，不再使用会被他人改写的全局 activePrintWindow。
 * - cancel 只"标记 cancelled 并销毁当前 context 拥有的窗口"，绝不释放并发锁；
 *   并发锁由该 start 自己的 finally 最终释放。因此在旧 start unwind 期间，
 *   新 start 被锁挡在外面，旧 start 的 finally 不可能清理到新 context 的窗口。
 * - 在保存对话框返回、load、ready、printToPDF 等异步边界检查 cancelled，
 *   取消后即使对话框已选路径也不会继续导出。
 * - 写文件区分 write-started 与 write-completed：只有写入开始后（writeStarted）
 *   的失败才清理目标文件（可能是部分产物）；真正写入前的 load/readiness 失败
 *   绝不删除用户原有目标文件。
 *
 * electron 特有能力（对话框/窗口/IPC/printToPDF/文件 IO/校验）通过 deps 注入，
 * 使本模块可在 Node 中直接驱动，编写可执行的生命周期/竞态测试。
 */

const { validatePdfExportOptions, buildPrintUrl } = require('./pdf-export-helpers.cjs')

function sanitizeExportError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/g, '[路径]')
    .replace(/\/(?:[^/\s]+\/)+[^/\s]*/g, '[路径]')
}

class PdfExportController {
  constructor() {
    /** 并发锁：同一时刻最多一个导出在运行。 */
    this.inProgress = false
    /** 当前活跃的导出 context；cancel 作用于此。 */
    this.activeContext = null
    /** context 序号（token），仅用于调试与测试断言。 */
    this.counter = 0
  }

  /**
   * 取消当前导出。
   * 只标记 cancelled 并销毁当前 context 拥有的窗口；不释放并发锁——
   * 锁由该 start 自己的 finally 释放，避免旧 start unwind 期间新 start 进入。
   */
  cancel() {
    const context = this.activeContext
    if (!context) {
      return { success: true }
    }
    context.cancelled = true
    if (context.printWindow && !context.printWindow.isDestroyed()) {
      context.printWindow.destroy()
    }
    return { success: true }
  }

  /**
   * 运行一次完整导出。
   * @param {{documentId?: string, revision?: number, pageCount?: number, title?: string}} options
   * @param {{
   *   appOrigin: string,
   *   showSaveDialog: (options: object) => Promise<{canceled: boolean, filePath?: string}>,
   *   createWindow: () => Promise<object> | object,
   *   waitForPageReady: (context: object) => Promise<object>,
   *   printToPDFOptions?: object,
   *   writeFile: (path: string, buffer: Buffer) => void,
   *   unlink: (path: string) => void,
   *   statSize: (path: string) => number,
   *   baseName: (path: string) => string,
   *   verify?: (path: string, pages: number) => Promise<{warnings: string[]}> | null,
   * }} deps
   */
  async runExport(options, deps) {
    if (this.inProgress) {
      return { success: false, error: '导出正在进行中，请等待完成。' }
    }
    const validationError = validatePdfExportOptions(options)
    if (validationError) {
      return { success: false, error: validationError }
    }
    // 必须复用 createWindow 已启动服务的 canonical origin，不从 argv/PORT 推断。
    if (!deps.appOrigin) {
      return { success: false, error: '应用服务尚未就绪，无法导出。' }
    }

    // 并发锁在打开保存对话框之前生效，且只能由本次 start 的 finally 释放。
    this.inProgress = true
    this.counter += 1
    const context = {
      id: this.counter,
      cancelled: false,
      printWindow: null,
      savePath: null,
      writeStarted: false,
      writeCompleted: false,
    }
    this.activeContext = context

    try {
      // 1. Save dialog
      const dialogResult = await deps.showSaveDialog(options)
      // 对话框返回边界：期间被取消则不再继续（即使用户已选路径）。
      if (context.cancelled) {
        return { success: false, canceled: true }
      }
      if (dialogResult.canceled || !dialogResult.filePath) {
        return { success: false, canceled: true }
      }
      context.savePath = dialogResult.filePath

      // 2. Hidden print window（归当前 context 所有）
      context.printWindow = await deps.createWindow()
      if (context.cancelled) {
        return { success: false, canceled: true }
      }

      // page-ready 监听必须在 loadURL 之前注册；readyPromise 挂载兑底 rejection 处理，
      // 避免 loadURL 失败或窗口被销毁时产生未处理 rejection。
      const readyPromise = deps.waitForPageReady(context)
      readyPromise.catch(() => {})

      // BrowserRouter 真实路径（非 hash），由前端 App.tsx 的 /print/* bypass 渲染。
      // 附带 paper 查询参数，供打印页交叉校验文档纸张与导出期望纸张。
      const printUrl = buildPrintUrl(deps.appOrigin, options.documentId, options.revision, options.paper)
      await context.printWindow.loadURL(printUrl)
      // load 边界：已被取消则不再等待 ready。
      if (context.cancelled) {
        return { success: false, canceled: true }
      }

      // 3. Wait for print readiness signal from renderer
      const readyPayload = await readyPromise
      // ready 边界：ready 期间被取消（窗口被销毁会 reject，此处兜底）则不导出。
      if (context.cancelled) {
        return { success: false, canceled: true }
      }

      // 4. Print to PDF
      const pdfBuffer = await context.printWindow.webContents.printToPDF(deps.printToPDFOptions || {})
      // printToPDF 边界：生成后、写文件前被取消，不得删除用户原有目标文件。
      if (context.cancelled) {
        return { success: false, canceled: true }
      }

      // 5. Write file。writeStarted 在真正写入前置位：写入开始后（含写入中失败、
      //    写入完成后校验失败）的失败才清理目标文件；此前的失败不触碰用户原有文件。
      context.writeStarted = true
      deps.writeFile(context.savePath, pdfBuffer)
      context.writeCompleted = true

      // 6. Basic verification
      const fileSize = deps.statSize(context.savePath)
      const reportedPages = (readyPayload && readyPayload.pageCount) || options.pageCount || 0
      if (fileSize < 1024) {
        // 校验失败：抛出后由 catch 清理失败产物，不返回成功。
        throw new Error(`PDF 文件过小（${fileSize} bytes），可能生成失败。`)
      }

      // 7. Optional PDF verification (best-effort)
      let verificationWarnings = []
      if (deps.verify) {
        try {
          const verifyResult = await deps.verify(context.savePath, reportedPages)
          if (verifyResult && verifyResult.success === false) {
            throw new Error('PDF 文件校验失败，请重新导出。')
          }
          if (verifyResult && Array.isArray(verifyResult.warnings) && verifyResult.warnings.length) {
            verificationWarnings = verifyResult.warnings
          }
        } catch (verifyErr) {
          throw new Error(
            verifyErr instanceof Error && verifyErr.message === 'PDF 文件校验失败，请重新导出。'
              ? verifyErr.message
              : 'PDF 文件校验进程异常，请重新导出。',
          )
        }
      }

      // 不向 renderer 返回绝对路径，仅返回文件名与大小。
      return {
        success: true,
        fileName: deps.baseName(context.savePath),
        fileSize,
        htmlPageCount: reportedPages,
        warnings: [...((readyPayload && readyPayload.warnings) || []), ...verificationWarnings],
      }
    } catch (error) {
      // 仅当写入已开始才清理目标文件（可能是部分产物）；
      // 写入开始前的 load/readiness 失败绝不删除用户原有目标文件。
      if (context.writeStarted && context.savePath) {
        try { deps.unlink(context.savePath) } catch (_unlinkErr) { /* ignore */ }
      }
      if (context.cancelled) {
        return { success: false, canceled: true }
      }
      return {
        success: false,
        error: sanitizeExportError(error),
      }
    } finally {
      // 只清理当前 context 自己的窗口；旧 context 的 finally 不会触碰新 context。
      if (context.printWindow && !context.printWindow.isDestroyed()) {
        context.printWindow.destroy()
      }
      context.printWindow = null
      // 锁与 activeContext 只能由当前 context 的 finally 释放/清空；
      // 若 activeContext 已不是本 context（防御），不得释放他人持有的锁。
      if (this.activeContext === context) {
        this.activeContext = null
        this.inProgress = false
      }
    }
  }
}

module.exports = { PdfExportController }
