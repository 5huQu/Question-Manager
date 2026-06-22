const { app, BrowserWindow, dialog, screen } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')
const { initUpdateHandlers } = require('./updater.cjs')

let serverProcess = null

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
      additionalArguments: [`--api-base-url=http://127.0.0.1:${port}`],
    },
  })

  setupDisplayAwareZoom(win)

  const appUrl = `http://127.0.0.1:${port}`
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
