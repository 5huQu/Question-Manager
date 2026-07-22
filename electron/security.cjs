const EXTERNAL_HOSTS = new Set([
  'chat.openai.com',
  'chat.qwen.ai',
  'chatgpt.com',
  'claude.ai',
  'gemini.google.com',
  'libreoffice.org',
  'www.doubao.com',
  'www.libreoffice.org',
])

function parsedUrl(value) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function isSameAppOrigin(value, appUrl) {
  const candidate = parsedUrl(value)
  const application = parsedUrl(appUrl)
  return Boolean(candidate && application && candidate.origin === application.origin)
}

function isAllowedExternalUrl(value) {
  const candidate = parsedUrl(value)
  return Boolean(candidate && candidate.protocol === 'https:' && EXTERNAL_HOSTS.has(candidate.hostname.toLowerCase()))
}

function popupSecurityOptions() {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  }
}

module.exports = {
  isAllowedExternalUrl,
  isSameAppOrigin,
  popupSecurityOptions,
}
