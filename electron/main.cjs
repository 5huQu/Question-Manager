const { app, BrowserWindow, dialog, ipcMain, screen, shell } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')
const { initUpdateHandlers } = require('./updater.cjs')
const { isAllowedExternalUrl, isSameAppOrigin, popupSecurityOptions } = require('./security.cjs')
const { PdfExportController } = require('./pdf-export-lifecycle.cjs')
const { buildPrintToPDFOptions } = require('./pdf-export-helpers.cjs')

let serverProcess = null
// 主应用窗口与已启动服务的 canonical origin。
// PDF 导出隐藏窗口必须复用 appOrigin，不能从主进程 process.argv / process.env.PORT 推断，
// 因为 createWindow 使用随机端口，主进程 argv/env 并不持有该端口。
let mainWindow = null
let appOrigin = null
// PDF 导出生命周期控制器：并发锁与导出 context 统一由此管理，
// 避免多 start 之间通过全局窗口引用互相清理的竞态。
const pdfExportController = new PdfExportController()

initUpdateHandlers()

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

function appRoot() {
  return app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..')
}

function bundledPythonPath(root) {
  const runtimeRoot = app.isPackaged ? process.resourcesPath : path.join(root, 'runtime')
  return process.platform === 'win32'
    ? path.join(runtimeRoot, 'python', 'python.exe')
    : path.join(runtimeRoot, 'python', 'bin', 'python3')
}

async function startServer(port) {
  const root = appRoot()
  const serverEntry = path.join(root, 'server', 'dist', 'index.js')
  const pythonPath = bundledPythonPath(root)
  if (!fs.existsSync(pythonPath)) {
    throw new Error(`Bundled Python runtime is missing: ${pythonPath}`)
  }
  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(port),
      QUESTION_DATA_DIR: app.getPath('userData'),
      PYTHON_PATH: pythonPath,
      QUESTION_PYTHON_RUNTIME: 'bundled',
      PYTHONNOUSERSITE: '1',
      PYTHONDONTWRITEBYTECODE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  serverProcess.stdout.on('data', (chunk) => process.stdout.write(chunk))
  serverProcess.stderr.on('data', (chunk) => process.stderr.write(chunk))
  serverProcess.on('exit', (code) => {
    if (code && !app.isQuitting) {
      dialog.showErrorBox('Question Manager', `Local server exited with code ${code}.`)
    }
  })
}

function waitForServer(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs

  return new Promise((resolve, reject) => {
    const check = () => {
      if (serverProcess?.exitCode !== null) {
        reject(new Error(`Local server exited with code ${serverProcess?.exitCode}.`))
        return
      }

      const request = http.get(`http://127.0.0.1:${port}/api/health`, (response) => {
        response.resume()
        if (response.statusCode === 200) {
          resolve()
          return
        }
        retry()
      })
      request.setTimeout(1000, () => request.destroy())
      request.on('error', retry)
    }

    const retry = () => {
      if (Date.now() >= deadline) {
        reject(new Error('Local server did not become ready within 15 seconds.'))
        return
      }
      setTimeout(check, 100)
    }

    check()
  })
}

function setupDisplayAwareZoom(win) {
  if (process.platform !== 'win32') return

  let lastZoomFactor = 1
  const updateZoomForDisplay = () => {
    if (win.isDestroyed()) return

    const display = screen.getDisplayMatching(win.getBounds())
    const scaleFactor = display.scaleFactor || 1
    const zoomFactor = Math.max(1, Math.min(1.18, scaleFactor >= 1.5 ? 1.08 : 1))

    if (Math.abs(zoomFactor - lastZoomFactor) > 0.001) {
      lastZoomFactor = zoomFactor
      win.webContents.setZoomFactor(zoomFactor)
    }
  }

  win.on('resize', updateZoomForDisplay)
  win.on('move', updateZoomForDisplay)
  screen.on('display-metrics-changed', updateZoomForDisplay)
  win.webContents.once('did-finish-load', updateZoomForDisplay)

  win.on('closed', () => {
    screen.removeListener('display-metrics-changed', updateZoomForDisplay)
  })
}

function secureWebContents(contents, appUrl) {
  contents.on('will-navigate', (event, navigationUrl) => {
    if (isSameAppOrigin(navigationUrl, appUrl)) return
    event.preventDefault()
    if (isAllowedExternalUrl(navigationUrl)) {
      void shell.openExternal(navigationUrl).catch((error) => console.error('Failed to open external URL:', error))
    }
  })
  contents.setWindowOpenHandler(({ url }) => {
    if (isSameAppOrigin(url, appUrl)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { webPreferences: popupSecurityOptions() },
      }
    }
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url).catch((error) => console.error('Failed to open external URL:', error))
    }
    return { action: 'deny' }
  })
}

async function createWindow() {
  const port = await getFreePort()
  await startServer(port)
  await waitForServer(port)

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--api-base-url=http://127.0.0.1:${port}`],
    },
  })

  setupDisplayAwareZoom(win)

  const appUrl = `http://127.0.0.1:${port}`
  // 记录当前主窗口与其 canonical origin，供 PDF 导出 IPC 复用与 sender 校验。
  mainWindow = win
  appOrigin = appUrl
  secureWebContents(win.webContents, appUrl)
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame) {
      dialog.showErrorBox(
        'Question Manager',
        `Unable to load the application (${errorCode}: ${errorDescription}).\n${validatedURL}`,
      )
    }
  })
  await win.loadURL(appUrl)
}

app.whenReady().then(createWindow).catch((error) => {
  dialog.showErrorBox('Question Manager', error instanceof Error ? error.message : String(error))
  app.quit()
})

app.on('before-quit', () => {
  app.isQuitting = true
  if (serverProcess && !serverProcess.killed) serverProcess.kill()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// ─── PDF Export IPC ───────────────────────────────────────────────────────────

/**
 * 等待打印页发出 ready 信号（context 作用域）。
 * - 监听器必须在 loadURL 之前注册，避免页面抢先发出信号；
 * - 只接受当前隐藏打印窗口 sender 发出的信号，忽略其他窗口；
 * - 窗口被销毁（用户取消）或超时时结束等待并移除监听器，避免 handler 悬挂。
 */
function waitForPageReady(context, timeoutMs = 30000) {
  const printWindow = context.printWindow
  return new Promise((resolve, reject) => {
    let settled = false
    let listener = null
    const removeListener = () => {
      if (listener) {
        ipcMain.removeListener('pdf-export:page-ready', listener)
        listener = null
      }
    }
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      removeListener()
      reject(new Error('打印页面准备超时（30s）。'))
    }, timeoutMs)

    const onClosed = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      removeListener()
      reject(new Error('导出窗口已关闭，导出取消。'))
    }
    printWindow.once('closed', onClosed)

    listener = (event, payload) => {
      // 只接受当前隐藏打印窗口的 sender，忽略其他窗口的信号。
      if (printWindow.isDestroyed() || event.sender.id !== printWindow.webContents.id) return
      if (settled) return
      settled = true
      clearTimeout(timeout)
      removeListener()
      if (payload && payload.error) {
        reject(new Error(String(payload.error)))
      } else {
        resolve(payload)
      }
    }
    ipcMain.on('pdf-export:page-ready', listener)
  })
}

function runPythonVerify(pythonPath, scriptPath, pdfPath, expectedPages, paper) {
  return new Promise((resolve) => {
    const args = [scriptPath, pdfPath]
    if (expectedPages > 0) args.push('--expected-pages', String(expectedPages))
    // 传递文档纸张物理尺寸（已含方向），供校验脚本按实际纸张验证 MediaBox，
    // 不再假定 A4。paper 缺失或宽高无效时跳过尺寸校验。
    const widthMm = paper ? Number(paper.widthMm) : NaN
    const heightMm = paper ? Number(paper.heightMm) : NaN
    if (Number.isFinite(widthMm) && widthMm > 0 && Number.isFinite(heightMm) && heightMm > 0) {
      args.push('--expected-width-mm', String(widthMm), '--expected-height-mm', String(heightMm))
    }
    const child = spawn(pythonPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    // 超时必须 kill 子进程，避免校验进程泄露。
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      if (!child.killed) child.kill()
      resolve({ success: false, warnings: ['PDF 校验超时（10s）'] })
    }, 10000)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      const warnings = []
      if (code !== 0) {
        // Parse JSON output for warnings
        try {
          const parsed = JSON.parse(stdout)
          if (Array.isArray(parsed.warnings)) warnings.push(...parsed.warnings)
          if (parsed.error) warnings.push(parsed.error)
        } catch (_e) {
          warnings.push(stderr.trim() || `PDF 校验返回非零退出码 (${code})`)
        }
      }
      resolve({ success: code === 0, warnings })
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ success: false, warnings: ['PDF 校验进程启动失败。'] })
    })
  })
}

ipcMain.handle('pdf-export:start', async (event, options) => {
  // sender 必须来自主应用窗口，拒绝其他窗口/隐藏窗口伪造的导出请求。
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
    return { success: false, error: '非法的导出请求来源。' }
  }
  const parentWindow = BrowserWindow.fromWebContents(event.sender)
  const exportOptions = options || {}
  // 导出生命周期所有权统一由控制器（pdf-export-lifecycle.cjs）持有：
  // 每次 start 拥有独立 context；cancel 只标记 cancelled 并销毁当前 context 的窗口；
  // 并发锁由该 start 自己的 finally 最终释放，旧 start unwind 期间新 start 被锁挡住，
  // 旧 start 的 finally 不可能清理到新 context 的窗口。
  return pdfExportController.runExport(exportOptions, {
    appOrigin,
    showSaveDialog: (opts) => {
      const defaultName = `${(opts.title || '讲义').replace(/[/\\:*?"<>|]/g, '_')}.pdf`
      return dialog.showSaveDialog(parentWindow, {
        title: '导出实验版 PDF',
        defaultPath: defaultName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
    },
    createWindow: () => {
      const printWindow = new BrowserWindow({
        width: 794,
        height: 1123,
        show: false,
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          additionalArguments: [`--api-base-url=${appOrigin}`],
        },
      })
      // 隐藏打印窗口同样应用现有安全策略（导航拦截 + window.open 管控）。
      secureWebContents(printWindow.webContents, appOrigin)
      return printWindow
    },
    // page-ready 监听必须在 loadURL 之前注册，调用顺序由控制器保证。
    waitForPageReady: (context) => waitForPageReady(context),
    // printToPDF 纸张参数由前端传入的 PaperSpec 动态生成，不再硬编码 A4；
    // 与打印页 @page { size: var(--td-page-size) } 同源，保证 MediaBox 与文档纸张一致。
    printToPDFOptions: buildPrintToPDFOptions(exportOptions.paper),
    writeFile: (filePath, buffer) => fs.writeFileSync(filePath, buffer),
    unlink: (filePath) => fs.unlinkSync(filePath),
    statSize: (filePath) => fs.statSync(filePath).size,
    baseName: (filePath) => path.basename(filePath),
    verify: (pdfPath, expectedPages) => {
      const root = appRoot()
      const pythonPath = bundledPythonPath(root)
      const verifyScript = path.join(root, 'server', 'python', 'scripts', 'verify_teaching_pdf.py')
      if (!fs.existsSync(pythonPath) || !fs.existsSync(verifyScript)) {
        return null
      }
      return runPythonVerify(pythonPath, verifyScript, pdfPath, expectedPages, exportOptions.paper)
    },
  })
})

ipcMain.handle('pdf-export:cancel', (event) => {
  // sender 必须来自主应用窗口。
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
    return { success: false, error: '非法的导出请求来源。' }
  }
  // cancel 只标记 cancelled 并销毁当前 context 拥有的窗口，绝不释放并发锁——
  // 锁由对应 start 自己的 finally 最终释放，避免旧 start unwind 期间新 start 进入互相清理。
  return pdfExportController.cancel()
})
