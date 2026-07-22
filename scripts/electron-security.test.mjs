import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { isAllowedExternalUrl, isSameAppOrigin, popupSecurityOptions } = require('../electron/security.cjs')

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

console.log('electron security policy ok')
