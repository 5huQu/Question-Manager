const { app, BrowserWindow, ipcMain, shell } = require('electron')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')
const path = require('node:path')

const UPDATE_CHANNELS = {
  PROGRESS: 'updates:progress',
  STATUS: 'updates:status',
}

let lastCheck = null
let downloadedAsset = null
let activeDownload = null

function stripVersionPrefix(version) {
  return String(version || '').trim().replace(/^v/i, '')
}

function compareVersions(left, right) {
  const a = stripVersionPrefix(left).split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0)
  const b = stripVersionPrefix(right).split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0)
  const length = Math.max(a.length, b.length, 3)
  for (let index = 0; index < length; index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0)
    if (delta !== 0) return delta > 0 ? 1 : -1
  }
  return 0
}

function platformKey() {
  return `${process.platform}-${process.arch}`
}

function safeFileNameFromUrl(url) {
  const parsed = new URL(url)
  const basename = path.basename(decodeURIComponent(parsed.pathname))
  return basename || `Question-Manager-${Date.now()}`
}

function loadUpdateConfig() {
  const configPath = path.join(__dirname, 'update-config.json')
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch {
    return {}
  }
}

function resolveManifestUrl() {
  const cliSwitch = app.commandLine.getSwitchValue('update-manifest-url')
  const config = loadUpdateConfig()
  return (
    process.env.QUESTION_UPDATE_MANIFEST_URL ||
    cliSwitch ||
    config.manifestUrl ||
    ''
  ).trim()
}

function requestUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const client = parsed.protocol === 'http:' ? http : https
    const request = client.get(parsed, { headers: { 'User-Agent': `QuestionManager/${app.getVersion()}` } }, (response) => {
      const status = response.statusCode || 0
      const location = response.headers.location
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        response.resume()
        if (redirectCount >= 5) {
          reject(new Error('更新地址重定向次数过多'))
          return
        }
        resolve(requestUrl(new URL(location, parsed).toString(), redirectCount + 1))
        return
      }
      if (status < 200 || status >= 300) {
        response.resume()
        reject(new Error(`更新服务器返回 HTTP ${status}`))
        return
      }
      resolve(response)
    })
    request.setTimeout(20000, () => request.destroy(new Error('连接更新服务器超时')))
    request.on('error', reject)
  })
}

async function fetchJson(url) {
  const response = await requestUrl(url)
  const chunks = []
  for await (const chunk of response) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function normalizeAsset(raw) {
  if (!raw || typeof raw.url !== 'string') return null
  return {
    url: raw.url,
    sha256: typeof raw.sha256 === 'string' ? raw.sha256.toLowerCase() : '',
    size: Number(raw.size || 0),
  }
}

function normalizeManifest(raw, key = platformKey()) {
  const asset = normalizeAsset(raw?.assets?.[key])
  return {
    version: String(raw?.version || ''),
    releaseDate: String(raw?.releaseDate || ''),
    notes: String(raw?.notes || ''),
    mandatory: Boolean(raw?.mandatory),
    platformKey: key,
    asset,
  }
}

async function checkForUpdates(options = {}) {
  const manifestUrl = resolveManifestUrl()
  const currentVersion = app.getVersion()
  const key = platformKey()
  if (!manifestUrl) {
    const result = {
      currentVersion,
      platformKey: key,
      updateAvailable: false,
      configured: false,
      message: '当前构建未配置更新地址。',
    }
    lastCheck = result
    return result
  }

  try {
    const manifest = normalizeManifest(await fetchJson(manifestUrl), key)
    const updateAvailable = Boolean(manifest.asset && manifest.version && compareVersions(manifest.version, currentVersion) > 0)
    const result = {
      ...manifest,
      currentVersion,
      latestVersion: manifest.version,
      updateAvailable,
      configured: true,
      manifestUrl,
      downloadedPath: downloadedAsset?.version === manifest.version ? downloadedAsset.path : '',
    }
    if (!manifest.asset) result.message = `当前平台暂无安装包：${key}`
    if (!updateAvailable && !result.message) result.message = '当前已是最新版本。'
    lastCheck = result
    if (!options.silent) broadcastStatus(result)
    return result
  } catch (error) {
    const result = {
      currentVersion,
      platformKey: key,
      updateAvailable: false,
      configured: true,
      manifestUrl,
      error: error instanceof Error ? error.message : String(error),
      message: '检查更新失败，请稍后重试。',
    }
    lastCheck = result
    if (!options.silent) broadcastStatus(result)
    return result
  }
}

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function broadcastProgress(payload) {
  broadcast(UPDATE_CHANNELS.PROGRESS, payload)
}

function broadcastStatus(payload) {
  broadcast(UPDATE_CHANNELS.STATUS, payload)
}

function updateDownloadsDir() {
  const dir = path.join(app.getPath('downloads'), 'Question Manager Updates')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function removeIfExists(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.rmSync(filePath, { force: true })
  } catch {
    // Best effort cleanup only.
  }
}

async function downloadToFile(asset, destination) {
  const response = await requestUrl(asset.url)
  const expectedSize = Number(response.headers['content-length'] || asset.size || 0)
  const hash = crypto.createHash('sha256')
  let downloaded = 0

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destination)
    response.on('data', (chunk) => {
      downloaded += chunk.length
      hash.update(chunk)
      broadcastProgress({
        downloaded,
        total: expectedSize,
        percent: expectedSize ? Math.round((downloaded / expectedSize) * 100) : 0,
      })
    })
    response.on('error', reject)
    output.on('error', reject)
    output.on('finish', resolve)
    response.pipe(output)
  })

  const digest = hash.digest('hex')
  if (asset.sha256 && digest !== asset.sha256) {
    throw new Error('安装包校验失败，请重新下载。')
  }
  return { sha256: digest, size: downloaded }
}

async function downloadUpdate() {
  if (activeDownload) return activeDownload
  activeDownload = (async () => {
    const check = lastCheck?.updateAvailable ? lastCheck : await checkForUpdates({ silent: true })
    if (!check.updateAvailable || !check.asset) {
      throw new Error(check.message || '当前没有可下载的新版本。')
    }

    const dir = updateDownloadsDir()
    const filename = safeFileNameFromUrl(check.asset.url)
    const destination = path.join(dir, filename)
    removeIfExists(destination)
    broadcastStatus({ phase: 'downloading', message: '正在下载更新安装包…', version: check.latestVersion })
    try {
      const file = await downloadToFile(check.asset, destination)
      downloadedAsset = {
        path: destination,
        version: check.latestVersion,
        platformKey: check.platformKey,
        ...file,
      }
      broadcastStatus({ phase: 'downloaded', message: '更新安装包已下载完成。', downloadedPath: destination, version: check.latestVersion })
      return { ...downloadedAsset, message: '更新安装包已下载完成。' }
    } catch (error) {
      removeIfExists(destination)
      broadcastStatus({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
      throw error
    }
  })()

  try {
    return await activeDownload
  } finally {
    activeDownload = null
  }
}

async function openDownloadedUpdate() {
  if (!downloadedAsset?.path || !fs.existsSync(downloadedAsset.path)) {
    throw new Error('还没有已下载的更新安装包。')
  }
  if (process.platform === 'win32') {
    const error = await shell.openPath(downloadedAsset.path)
    if (error) throw new Error(error)
    return { opened: true, message: '已打开安装包。请按提示覆盖安装。' }
  }
  shell.showItemInFolder(downloadedAsset.path)
  return { opened: true, message: '已在 Finder 中显示安装包。请解压后替换旧版应用。' }
}

function initUpdateHandlers() {
  ipcMain.handle('updates:check', (_event, options) => checkForUpdates(options || {}))
  ipcMain.handle('updates:download', () => downloadUpdate())
  ipcMain.handle('updates:open-downloaded', () => openDownloadedUpdate())
}

module.exports = {
  compareVersions,
  initUpdateHandlers,
  normalizeManifest,
  platformKey,
  resolveManifestUrl,
}
