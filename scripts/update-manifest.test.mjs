import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { compareVersions, normalizeManifest } = require('../electron/updater.cjs')

assert.equal(compareVersions('0.1.10', '0.1.9'), 1)
assert.equal(compareVersions('v0.1.9', '0.1.10'), -1)
assert.equal(compareVersions('1.0.0', '1.0'), 0)
assert.equal(compareVersions('1.2.0', '1.10.0'), -1)

const manifest = normalizeManifest({
  version: '0.1.2',
  releaseDate: '2026-06-22T00:00:00.000Z',
  notes: '更新说明',
  mandatory: false,
  assets: {
    'win32-x64': {
      url: 'https://example.com/Question-Manager-Setup-0.1.2-x64.exe',
      sha256: 'ABCDEF',
      size: 123,
    },
  },
}, 'win32-x64')

assert.equal(manifest.version, '0.1.2')
assert.equal(manifest.platformKey, 'win32-x64')
assert.equal(manifest.asset?.sha256, 'abcdef')
assert.equal(manifest.asset?.size, 123)

const missingAsset = normalizeManifest({ version: '0.1.2', assets: {} }, 'darwin-arm64')
assert.equal(missingAsset.asset, null)

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'question-updates-'))
const filePath = path.join(tempDir, 'payload.txt')
fs.writeFileSync(filePath, 'question-manager')
const digest = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
assert.equal(digest, '000cc63994805c35704ac79a1614921196f5f53bee391f1680a09300ad92be45')

fs.rmSync(tempDir, { recursive: true, force: true })
console.log('Update manifest tests passed')
