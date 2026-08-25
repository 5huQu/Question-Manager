import { describe, expect, it, vi } from 'vitest'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { createDefaultPrintLayout } from './printLayout'
import { DEFAULT_A4_PAPER } from './paper'
import { createTeachingDocumentLayoutSignatures } from './signatures'
import { teachingDocumentSkinDesignSignature } from '../skins'

function fixture(): TeachingDocumentV1 {
  return {
    version: 1,
    documentType: 'worksheet',
    title: '签名测试',
    metadata: {},
    content: [
      { type: 'paragraph', id: 'p', content: [{ type: 'text', text: '正文' }] },
      { type: 'question', id: 'q', questionId: 'question-1', display: { showAnswer: false } },
      {
        type: 'figure',
        id: 'f',
        asset: { type: 'documentAsset', assetId: 'asset-1' },
        alignment: 'center',
      },
    ],
  }
}

function signatures(document: TeachingDocumentV1, variant: 'student' | 'teacher' = 'student', renderVersion = 'q1:r1') {
  return createTeachingDocumentLayoutSignatures({
    document,
    paper: DEFAULT_A4_PAPER,
    printLayout: createDefaultPrintLayout(DEFAULT_A4_PAPER),
    fontVars: { '--td-body-font': 'Noto Sans SC' },
    renderVersion,
    spread: false,
    variant,
  })
}

describe('teaching document layout signatures', () => {
  it('is stable for structurally equal documents without JSON stringifying the full content', () => {
    const stringify = vi.spyOn(JSON, 'stringify')
    expect(signatures(fixture())).toEqual(signatures(structuredClone(fixture())))
    expect(stringify).not.toHaveBeenCalled()
    stringify.mockRestore()
  })

  it('keeps resource revision stable for text, visibility, and variant-only changes', () => {
    const source = fixture()
    const baseline = signatures(source, 'student')
    const textChanged = structuredClone(source)
    const paragraph = textChanged.content[0]
    if (paragraph.type === 'paragraph') paragraph.content[0] = { type: 'text', text: '新正文' }
    const visibilityChanged = structuredClone(source)
    const question = visibilityChanged.content[1]
    if (question.type === 'question') question.display = { ...question.display, showAnswer: true }

    expect(signatures(textChanged, 'student').resourceRevision).toBe(baseline.resourceRevision)
    expect(signatures(visibilityChanged, 'student').resourceRevision).toBe(baseline.resourceRevision)
    expect(signatures(source, 'teacher').resourceRevision).toBe(baseline.resourceRevision)
    expect(signatures(source, 'teacher').paginationSignature).not.toBe(baseline.paginationSignature)
  })

  it('invalidates resource and pagination signatures when a real resource revision changes', () => {
    const source = fixture()
    const baseline = signatures(source)
    const resourceChanged = structuredClone(source)
    const figure = resourceChanged.content[2]
    if (figure.type === 'figure') figure.asset = { type: 'documentAsset', assetId: 'asset-2' }

    expect(signatures(resourceChanged).resourceRevision).not.toBe(baseline.resourceRevision)
    expect(signatures(source, 'student', 'q1:r2').resourceRevision).not.toBe(baseline.resourceRevision)
    expect(signatures(resourceChanged).paginationSignature).not.toBe(baseline.paginationSignature)
  })

  it('separates layout style invalidation from block content', () => {
    const source = fixture()
    const baseline = signatures(source)
    const styled = structuredClone(source)
    styled.style = { marginPreset: 'compact' }
    const next = signatures(styled)

    expect(next.blockContentSignature).toBe(baseline.blockContentSignature)
    expect(next.resourceRevision).toBe(baseline.resourceRevision)
    expect(next.layoutStyleSignature).not.toBe(baseline.layoutStyleSignature)
    expect(next.paginationSignature).not.toBe(baseline.paginationSignature)
  })

  it('treats resolved Skin design state as geometry-affecting', () => {
    const source = {
      ...fixture(),
      content: [{ type: 'heading' as const, id: 'skin-heading', level: 2 as const, content: [{ type: 'text' as const, text: '标题' }], skin: { id: 'builtin.heading.left-accent', version: 1 } }],
    }
    const baseSkinDesign = teachingDocumentSkinDesignSignature(source)
    const amberSkinDesign = teachingDocumentSkinDesignSignature(source, { 'builtin.heading.left-accent': 'amber' })
    expect(amberSkinDesign).not.toBe(baseSkinDesign)
    const base = createTeachingDocumentLayoutSignatures({
      document: source, paper: DEFAULT_A4_PAPER, printLayout: createDefaultPrintLayout(DEFAULT_A4_PAPER), spread: false,
      skinDesignSignature: baseSkinDesign,
    })
    const variant = createTeachingDocumentLayoutSignatures({
      document: source, paper: DEFAULT_A4_PAPER, printLayout: createDefaultPrintLayout(DEFAULT_A4_PAPER), spread: false,
      skinDesignSignature: amberSkinDesign,
    })
    expect(variant.layoutStyleSignature).not.toBe(base.layoutStyleSignature)
    expect(variant.geometrySignature).not.toBe(base.geometrySignature)
    expect(variant.paginationSignature).not.toBe(base.paginationSignature)
  })
})
