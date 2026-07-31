import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { isAllowedExternalUrl, isSameAppOrigin, popupSecurityOptions } = require('../electron/security.cjs')
const { validatePdfExportOptions, buildPrintToPDFOptions, buildPrintUrl } = require('../electron/pdf-export-helpers.cjs')
const { PdfExportController } = require('../electron/pdf-export-lifecycle.cjs')

const appUrl = 'http://127.0.0.1:8797'
assert.equal(isSameAppOrigin('http://127.0.0.1:8797/assets/report.pdf', appUrl), true)
assert.equal(isSameAppOrigin('http://127.0.0.1:5174/', appUrl), false)
assert.equal(isSameAppOrigin('https://chatgpt.com/', appUrl), false)
assert.equal(isAllowedExternalUrl('https://chatgpt.com/'), true)
assert.equal(isAllowedExternalUrl('https://www.libreoffice.org/download/'), true)
assert.equal(isAllowedExternalUrl('http://chatgpt.com/'), false)
assert.equal(isAllowedExternalUrl('https://chatgpt.com.evil.example/'), false)
assert.equal(isAllowedExternalUrl('javascript:alert(1)'), false)
assert.deepEqual(popupSecurityOptions(), {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
})

const projectRoot = path.resolve(import.meta.dirname, '..')
const mainSource = fs.readFileSync(path.join(projectRoot, 'electron/main.cjs'), 'utf8')
const htmlSource = fs.readFileSync(path.join(projectRoot, 'frontend/index.html'), 'utf8')
assert.match(mainSource, /sandbox:\s*true/)
assert.match(mainSource, /\.on\(['"]will-navigate['"]/)
assert.match(mainSource, /\.setWindowOpenHandler\(/)
assert.match(htmlSource, /Content-Security-Policy/)
assert.match(htmlSource, /object-src 'none'/)

const lifecycleSource = fs.readFileSync(path.join(projectRoot, 'electron/pdf-export-lifecycle.cjs'), 'utf8')
// ─── PDF 导出 IPC 安全与清理约束（源级断言） ─────────────────────────
// page-ready 监听只接受当前隐藏窗口的 sender，避免其他窗口伪造 ready 信号。
assert.match(mainSource, /event\.sender\.id !== printWindow\.webContents\.id/)
// page-ready 监听必须在 loadURL 之前注册（控制器先调 waitForPageReady 再 loadURL）。
assert.ok(
  lifecycleSource.indexOf('deps.waitForPageReady(context)') !== -1
  && lifecycleSource.indexOf('deps.waitForPageReady(context)') < lifecycleSource.indexOf('context.printWindow.loadURL(printUrl)'),
  'page-ready listener must be registered before loadURL',
)
// 成功/失败/取消/文件过小都在 finally 统一销毁隐藏窗口并释放锁（context 作用域，旧不清新）。
assert.match(lifecycleSource, /finally\s*{[\s\S]*?context\.printWindow\.destroy\(\)/)
assert.match(lifecycleSource, /finally\s*{[\s\S]*?this\.inProgress = false/)
// 校验超时必须 kill Python 子进程。
assert.match(mainSource, /child\.kill\(\)/)
// renderer 不接收绝对路径：成功结果不返回 filePath。
assert.ok(
  !mainSource.includes('filePath: savePath') && !lifecycleSource.includes('filePath: context.savePath'),
  'must not return absolute filePath to renderer',
)
// ─── PDF 导出参数校验（可执行测试，非字符串断言） ─────────────
// documentId 必须为非空字符串。
assert.equal(validatePdfExportOptions({}), '缺少文档 ID。')
assert.equal(validatePdfExportOptions({ documentId: '   ' }), '缺少文档 ID。')
assert.equal(validatePdfExportOptions({ documentId: 123 }), '缺少文档 ID。')
// revision/pageCount 如提供必须为非负整数。
assert.equal(validatePdfExportOptions({ documentId: 'd', revision: -1 }), 'revision 参数无效。')
assert.equal(validatePdfExportOptions({ documentId: 'd', revision: 1.5 }), 'revision 参数无效。')
assert.equal(validatePdfExportOptions({ documentId: 'd', pageCount: -2 }), 'pageCount 参数无效。')
assert.equal(validatePdfExportOptions({ documentId: 'd', title: 42 }), 'title 参数无效。')
assert.equal(validatePdfExportOptions({ documentId: 'd', variant: 'answer-key' }), '导出版本无效。')
// 合法参数返回 null（revision/pageCount/title 可省略，revision=0 合法）。
assert.equal(validatePdfExportOptions({ documentId: 'doc_1' }), null)
assert.equal(validatePdfExportOptions({ documentId: 'doc_1', revision: 0, pageCount: 3, title: '讲义' }), null)
assert.equal(validatePdfExportOptions({ documentId: 'doc_1', variant: 'teacher' }), null)

// ─── 打印 URL 必须基于 canonical origin（可执行测试） ─────────────
// URL 纯由传入的 appOrigin 构造，不依赖 argv/PORT；正确编码 documentId 与 revision。
assert.equal(
  buildPrintUrl('http://127.0.0.1:51234', 'doc 1', 3),
  'http://127.0.0.1:51234/print/teaching-document?docId=doc%201&revision=3',
)
// revision 省略时默认 0；随机端口 origin 原样保留。
assert.equal(
  buildPrintUrl('http://127.0.0.1:60000', 'x'),
  'http://127.0.0.1:60000/print/teaching-document?docId=x&revision=0',
)
assert.equal(
  buildPrintUrl('http://127.0.0.1:60000', 'x', 2, undefined, 'teacher'),
  'http://127.0.0.1:60000/print/teaching-document?docId=x&revision=2&variant=teacher',
)

// ─── 纸张参数校验（可执行测试） ─────────────
// paper 可省略；提供时 size/orientation/宽高必须合法。
assert.equal(validatePdfExportOptions({ documentId: 'd', paper: null }), null)
assert.equal(validatePdfExportOptions({
  documentId: 'd',
  paper: { size: 'A3', orientation: 'landscape', widthMm: 420, heightMm: 297, marginTopMm: 22, marginRightMm: 20, marginBottomMm: 22, marginLeftMm: 20 },
}), null)
assert.equal(validatePdfExportOptions({ documentId: 'd', paper: 'A4' }), 'paper 参数无效。')
assert.equal(validatePdfExportOptions({ documentId: 'd', paper: { size: 'B5' } }), '纸张尺寸无效。')
assert.equal(validatePdfExportOptions({ documentId: 'd', paper: { orientation: 'diagonal' } }), '纸张方向无效。')
assert.equal(validatePdfExportOptions({ documentId: 'd', paper: { widthMm: -1 } }), '纸张宽度无效。')
assert.equal(validatePdfExportOptions({ documentId: 'd', paper: { widthMm: 210, heightMm: 0 } }), '纸张高度无效。')

// ─── 打印 URL 附带纸张参数（可执行测试） ─────────────
// 提供 paper 时 JSON 序列化附加到查询串，供打印页交叉校验。
{
  const paper = { size: 'A4', orientation: 'portrait', widthMm: 210, heightMm: 297, marginTopMm: 18, marginRightMm: 16, marginBottomMm: 18, marginLeftMm: 16 }
  const url = buildPrintUrl('http://127.0.0.1:51234', 'doc-1', 3, paper)
  const parsed = new URL(url)
  assert.equal(parsed.searchParams.get('docId'), 'doc-1')
  assert.equal(parsed.searchParams.get('revision'), '3')
  assert.deepEqual(JSON.parse(parsed.searchParams.get('paper')), paper)
}

// ─── printToPDF 参数生成（可执行测试）：绝不硬编码 A4 ─────────────
// A4 portrait：物理尺寸 210×297mm → 英寸 pageSize。
{
  const opts = buildPrintToPDFOptions({ size: 'A4', orientation: 'portrait', widthMm: 210, heightMm: 297 })
  assert.equal(opts.preferCSSPageSize, true)
  assert.equal(opts.marginsType, 1)
  assert.equal(opts.landscape, false)
  assert.ok(Math.abs(opts.pageSize.width - 210 / 25.4) < 1e-9)
  assert.ok(Math.abs(opts.pageSize.height - 297 / 25.4) < 1e-9)
}
// A4 landscape：PaperSpec 宽高已含方向（297×210），pageSize 直接用物理尺寸，不二次旋转。
{
  const opts = buildPrintToPDFOptions({ size: 'A4', orientation: 'landscape', widthMm: 297, heightMm: 210 })
  assert.ok(Math.abs(opts.pageSize.width - 297 / 25.4) < 1e-9)
  assert.ok(Math.abs(opts.pageSize.height - 210 / 25.4) < 1e-9)
  assert.equal(opts.landscape, false)
}
// A3 landscape：420×297mm。
{
  const opts = buildPrintToPDFOptions({ size: 'A3', orientation: 'landscape', widthMm: 420, heightMm: 297 })
  assert.ok(Math.abs(opts.pageSize.width - 420 / 25.4) < 1e-9)
  assert.ok(Math.abs(opts.pageSize.height - 297 / 25.4) < 1e-9)
}
// paper 缺失或宽高无效：不硬编码 A4，仅依赖打印页 CSS @page 尺寸。
{
  const fallback = buildPrintToPDFOptions(undefined)
  assert.equal(fallback.pageSize, undefined)
  assert.equal(fallback.preferCSSPageSize, true)
  const invalid = buildPrintToPDFOptions({ size: 'A4', widthMm: 0, heightMm: 297 })
  assert.equal(invalid.pageSize, undefined)
}
// 任何输出都不得出现 A4 字符串硬编码。
assert.ok(!JSON.stringify(buildPrintToPDFOptions({ size: 'A4', orientation: 'portrait', widthMm: 210, heightMm: 297 })).includes('"A4"'))

// ─── print.css 无 A4 硬编码（grep 测试） ─────────────
// 除 CSS 变量回退 var(--td-page-size, A4) 外，打印样式不得出现 size: A4 / 210mm / 297mm。
{
  const printCss = fs.readFileSync(path.join(projectRoot, 'frontend/src/components/teaching-document/print.css'), 'utf8')
  const hardcoded = printCss.match(/size:\s*A4|210mm|297mm/g) || []
  assert.deepEqual(hardcoded, [], `print.css 存在 A4 硬编码残留: ${hardcoded.join(', ')}`)
}

// ─── canonical origin / sender / 安全策略 / 生命周期所有权（源级结构断言） ─────────────
// 不能从主进程 argv 的 --api-base-url 或 process.env.PORT 推断打印地址。
assert.ok(
  !mainSource.includes("process.argv.find((arg) => arg.startsWith('--api-base-url=')"),
  'must not infer print url from process.argv',
)
assert.ok(
  !mainSource.includes('process.env.PORT || 8797'),
  'must not infer print url from process.env.PORT',
)
// createWindow 记录 canonical origin 与主窗口；导出复用 canonical origin 构造打印 URL。
assert.match(mainSource, /appOrigin = appUrl/)
assert.match(mainSource, /mainWindow = win/)
assert.match(mainSource, /pdfExportController\.runExport\(/)
assert.match(lifecycleSource, /buildPrintUrl\(deps\.appOrigin, options\.documentId, options\.revision, options\.paper, options\.variant\)/)
// start/cancel 的 sender 必须来自主应用窗口。
assert.match(mainSource, /event\.sender\.id !== mainWindow\.webContents\.id/)
// 隐藏打印窗口应用现有 secureWebContents 安全策略。
assert.match(mainSource, /secureWebContents\(printWindow\.webContents, appOrigin\)/)
// load 与 ready 等待绑定：readyPromise 挂载兑底 rejection 处理，避免未处理异常。
assert.match(lifecycleSource, /readyPromise\.catch\(\(\) => \{\}\)/)
// 并发锁在打开保存对话框之前生效。
assert.ok(
  lifecycleSource.indexOf('this.inProgress = true') !== -1
  && lifecycleSource.indexOf('this.inProgress = true') < lifecycleSource.indexOf('deps.showSaveDialog(options)'),
  'concurrency lock must be acquired before opening the save dialog',
)
// cancel 只标记 cancelled 并销毁当前 context 窗口，绝不释放并发锁。
assert.match(lifecycleSource, /cancel\(\)\s*{[\s\S]*?context\.cancelled = true[\s\S]*?context\.printWindow\.destroy\(\)/)
// 写入开始后失败清理目标文件；写入开始前的失败不得删除用户原有文件。
assert.match(mainSource, /fs\.unlinkSync\(filePath\)/)
assert.match(lifecycleSource, /if \(context\.writeStarted && context\.savePath\)/)

// ─── PDF 导出生命周期/竞态（可执行测试，驱动真实 controller） ─────────────
const tick = () => new Promise((resolve) => setImmediate(resolve))

function makeDeps(overrides = {}) {
  const calls = { createWindow: 0, loadURL: [], writeFile: [], unlink: [], lastWindow: null }
  const gates = { dialog: null, ready: null, print: null }
  const deps = {
    appOrigin: 'http://127.0.0.1:51234',
    calls,
    gates,
    showSaveDialog: async () => {
      if (gates.dialog) await gates.dialog
      return { canceled: false, filePath: '/tmp/out.pdf' }
    },
    createWindow: () => {
      calls.createWindow += 1
      const win = {
        destroyed: false,
        isDestroyed() { return this.destroyed },
        destroy() { this.destroyed = true },
        loadURL: async (url) => { calls.loadURL.push(url) },
        webContents: {
          printToPDF: async () => {
            if (gates.print) await gates.print
            return Buffer.alloc(2048, 1)
          },
        },
      }
      calls.lastWindow = win
      return win
    },
    waitForPageReady: async () => {
      if (gates.ready) await gates.ready
      return { pageCount: 2, warnings: [] }
    },
    printToPDFOptions: { pageSize: 'A4' },
    writeFile: (p, buf) => { calls.writeFile.push([p, buf.length]) },
    unlink: (p) => { calls.unlink.push(p) },
    statSize: () => 2048,
    baseName: (p) => p.split('/').pop(),
    ...overrides,
  }
  return deps
}

// 无活跃导出时 cancel 安全无副作用。
assert.deepEqual(new PdfExportController().cancel(), { success: true })

// 参数校验失败与 appOrigin 缺失不得获取并发锁。
{
  const controller = new PdfExportController()
  const bad = await controller.runExport({}, makeDeps())
  assert.equal(bad.success, false)
  assert.match(bad.error, /缺少文档 ID/)
  const noOrigin = await controller.runExport({ documentId: 'd' }, makeDeps({ appOrigin: '' }))
  assert.equal(noOrigin.success, false)
  assert.match(noOrigin.error, /尚未就绪/)
  assert.equal(controller.inProgress, false)
}

// 正常路径：成功后锁释放、URL 基于 canonical origin、无清理。
{
  const controller = new PdfExportController()
  const deps = makeDeps()
  const result = await controller.runExport({ documentId: 'doc-1', revision: 3 }, deps)
  assert.equal(result.success, true)
  assert.equal(result.fileName, 'out.pdf')
  assert.equal(result.fileSize, 2048)
  assert.deepEqual(deps.calls.loadURL, ['http://127.0.0.1:51234/print/teaching-document?docId=doc-1&revision=3'])
  assert.equal(deps.calls.writeFile.length, 1)
  assert.equal(deps.calls.unlink.length, 0)
  assert.equal(controller.inProgress, false)
  assert.equal(controller.activeContext, null)
}

// 学生版/教师版沿生命周期透传到打印页 URL。
{
  const controller = new PdfExportController()
  const deps = makeDeps()
  const result = await controller.runExport({ documentId: 'doc-1', revision: 3, variant: 'teacher' }, deps)
  assert.equal(result.success, true)
  assert.deepEqual(deps.calls.loadURL, ['http://127.0.0.1:51234/print/teaching-document?docId=doc-1&revision=3&variant=teacher'])
}

// PDF 结构校验失败必须阻断成功结果，并清理已写入的无效产物。
{
  const controller = new PdfExportController()
  const deps = makeDeps({
    verify: async () => ({ success: false, warnings: ['Page count mismatch: /Users/private/report.pdf'] }),
  })
  const result = await controller.runExport({ documentId: 'doc-1' }, deps)
  assert.equal(result.success, false)
  assert.match(result.error, /PDF 文件校验失败/)
  assert.equal(deps.calls.unlink.length, 1)
}

// 导出错误不得把用户选定的绝对路径返回给 renderer。
{
  const controller = new PdfExportController()
  const deps = makeDeps({
    writeFile: () => { throw new Error('无法写入 /Users/private/secret.pdf') },
  })
  const result = await controller.runExport({ documentId: 'doc-1' }, deps)
  assert.equal(result.success, false)
  assert.equal(result.error.includes('/Users/private/secret.pdf'), false)
  assert.match(result.error, /路径/)
}

// 用户在对话框取消：不创建窗口，锁释放。
{
  const controller = new PdfExportController()
  const deps = makeDeps({ showSaveDialog: async () => ({ canceled: true }) })
  const result = await controller.runExport({ documentId: 'doc-1' }, deps)
  assert.deepEqual(result, { success: false, canceled: true })
  assert.equal(deps.calls.createWindow, 0)
  assert.equal(controller.inProgress, false)
}

// 核心竞态：cancel 只标记不释放锁；旧 start unwind 期间新 start 被锁挡住；
// 对话框期间取消后，即使用户已选路径也不继续；锁最终由第一个 start 的 finally 释放。
{
  const controller = new PdfExportController()
  const deps = makeDeps()
  let releaseDialog
  deps.gates.dialog = new Promise((resolve) => { releaseDialog = resolve })
  const startA = controller.runExport({ documentId: 'A' }, deps)
  await tick()
  assert.equal(controller.inProgress, true)
  controller.cancel()
  assert.equal(controller.inProgress, true, 'cancel 不得释放并发锁')
  const startB = await controller.runExport({ documentId: 'B' }, makeDeps())
  assert.equal(startB.success, false)
  assert.match(startB.error, /正在进行中/)
  releaseDialog()
  const resultA = await startA
  assert.deepEqual(resultA, { success: false, canceled: true })
  assert.equal(deps.calls.createWindow, 0, '取消后不得创建窗口')
  assert.equal(deps.calls.writeFile.length, 0)
  assert.equal(controller.inProgress, false, '锁必须由第一个 start 的 finally 释放')
  assert.equal(controller.activeContext, null)
}

// cancel 销毁当前 context 窗口；ready 期间取消同样终止导出；
// 旧 context 完全 unwind 后新导出可正常完成。
{
  const controller = new PdfExportController()
  const deps = makeDeps()
  let releaseReady
  deps.gates.ready = new Promise((resolve) => { releaseReady = resolve })
  const startP = controller.runExport({ documentId: 'A' }, deps)
  await tick()
  const windowA = deps.calls.lastWindow
  assert.ok(windowA, '窗口应已创建')
  controller.cancel()
  assert.equal(windowA.destroyed, true, 'cancel 应销毁当前 context 的窗口')
  assert.equal(controller.inProgress, true)
  releaseReady()
  const result = await startP
  assert.deepEqual(result, { success: false, canceled: true })
  assert.equal(controller.inProgress, false)
  const depsC = makeDeps()
  const resultC = await controller.runExport({ documentId: 'C' }, depsC)
  assert.equal(resultC.success, true)
}

// printToPDF 后、写文件前取消：不得写文件，也不得删除用户原有目标文件。
{
  const controller = new PdfExportController()
  const deps = makeDeps()
  let releasePrint
  deps.gates.print = new Promise((resolve) => { releasePrint = resolve })
  const startP = controller.runExport({ documentId: 'doc-1' }, deps)
  await tick()
  controller.cancel()
  releasePrint()
  const result = await startP
  assert.deepEqual(result, { success: false, canceled: true })
  assert.equal(deps.calls.writeFile.length, 0, '取消后不得写文件')
  assert.equal(deps.calls.unlink.length, 0, '写入前取消不得删除用户原有文件')
  assert.equal(controller.inProgress, false)
}

// 写入开始前的 load/readiness 失败：绝不删除用户原有目标文件。
{
  const controller = new PdfExportController()
  const deps = makeDeps({ waitForPageReady: async () => { throw new Error('render failed') } })
  const result = await controller.runExport({ documentId: 'doc-1' }, deps)
  assert.equal(result.success, false)
  assert.match(result.error, /render failed/)
  assert.equal(deps.calls.unlink.length, 0, '写入前失败不得删除用户原有文件')
  assert.equal(controller.inProgress, false)
}

// 写入开始后失败（文件过小/写入异常）：清理可能的部分产物。
{
  const controller = new PdfExportController()
  const deps = makeDeps({ statSize: () => 10 })
  const result = await controller.runExport({ documentId: 'doc-1' }, deps)
  assert.equal(result.success, false)
  assert.match(result.error, /文件过小/)
  assert.deepEqual(deps.calls.unlink, ['/tmp/out.pdf'], '写入开始后失败必须清理产物')
  assert.equal(controller.inProgress, false)
}
{
  const controller = new PdfExportController()
  const deps = makeDeps({ writeFile: () => { throw new Error('ENOSPC') } })
  const result = await controller.runExport({ documentId: 'doc-1' }, deps)
  assert.equal(result.success, false)
  assert.match(result.error, /ENOSPC/)
  assert.deepEqual(deps.calls.unlink, ['/tmp/out.pdf'])
  assert.equal(controller.inProgress, false)
}

console.log('electron security policy ok')
