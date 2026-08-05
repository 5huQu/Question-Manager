#!/usr/bin/env node

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'preflight-teaching-document.mjs')
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teaching-document-preflight-'))

function run(name, document, expectedValid, code) {
  const input = path.join(tempDir, `${name}.json`)
  fs.writeFileSync(input, JSON.stringify(document))
  try {
    const output = execFileSync(process.execPath, [script, input], { encoding: 'utf8' })
    const report = JSON.parse(output)
    assert.equal(expectedValid, true, `${name} should fail with ${code}`)
    assert.equal(report.valid, true)
  } catch (error) {
    const report = JSON.parse(String(error.stdout || '{}'))
    assert.equal(expectedValid, false, `${name} unexpectedly failed: ${error.message}`)
    assert.equal(report.valid, false)
    assert.equal(report.errors.some((issue) => issue.code === code), true, `${name} is missing ${code}`)
  }
}

try {
  for (const documentType of ['lecture', 'worksheet', 'exam']) {
    run(`valid-${documentType}`, {
      version: 1, documentType, title: `${documentType} draft`, metadata: {}, content: [
        { type: 'heading', id: `${documentType}-heading`, level: 1, content: [{ type: 'text', text: '标题' }] },
        { type: 'paragraph', id: `${documentType}-paragraph`, content: [{ type: 'text', text: '设 ' }, { type: 'inlineMath', latex: 'x>0' }] },
        { type: 'box', id: `${documentType}-box`, templateId: 'concept', breakBehavior: 'auto', children: [{ type: 'blockMath', id: `${documentType}-math`, latex: 'x^2' }] },
      ],
    }, true)
  }
  run('duplicate-id', {
    version: 1, documentType: 'lecture', title: '重复', metadata: {}, content: [
      { type: 'divider', id: 'same' }, { type: 'spacer', id: 'same', heightEm: 1 },
    ],
  }, false, 'duplicate-id')
  run('empty-question', {
    version: 1, documentType: 'worksheet', title: '题目', metadata: {}, content: [{ type: 'question', id: 'q1', questionId: '' }],
  }, false, 'invalid-question-ref')
  run('nested-box', {
    version: 1, documentType: 'lecture', title: '卡片', metadata: {}, content: [{ type: 'box', id: 'box1', templateId: 'concept', breakBehavior: 'auto', children: [{ type: 'box', id: 'box2', templateId: 'method', breakBehavior: 'auto', children: [] }] }],
  }, false, 'illegal-box-child')
  run('absolute-path', {
    version: 1, documentType: 'lecture', title: '图片', metadata: {}, content: [{ type: 'figure', id: 'fig1', asset: { type: 'legacyPath', path: '/private/image.png' }, alignment: 'center' }],
  }, false, 'nonportable-legacy-path')
  console.log('Teaching document preflight checks passed.')
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true })
}

