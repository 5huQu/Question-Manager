import { describe, expect, it } from 'vitest'
import type { TeachingSkinRef } from '@/types/teachingDocument'
import { TeachingSkinRegistry } from './registry'
import { resolveBoxSkin, resolveHeadingSkin } from './resolver'
import { defineBoxSkin, defineHeadingSkin, parseTeachingSkinRef } from './types'

const heading = defineHeadingSkin({
  id: 'test.heading.level-one', label: '一级标题', version: 1, printSafe: true, className: 'test-heading', supportedLevels: [1],
})
const box = defineBoxSkin({
  id: 'test.box.concept', label: '概念卡', version: 1, printSafe: true, className: 'test-box', supportedTemplates: ['concept'],
})
const headingRef: TeachingSkinRef = { id: heading.id, version: 1 }
const boxRef: TeachingSkinRef = { id: box.id, version: 1 }

describe('TeachingSkinRegistry', () => {
  it('registers skins once and filters them by target', () => {
    const registry = new TeachingSkinRegistry()
    registry.register(heading)
    registry.register(box)
    expect(registry.list('heading')).toEqual([heading])
    expect(registry.list('box')).toEqual([box])
    expect(() => registry.register(heading)).toThrow(/already registered/)
  })
})

describe('teaching skin resolver', () => {
  const registry = new TeachingSkinRegistry()
  registry.register(heading)
  registry.register(box)

  it('resolves explicit compatible skins and leaves undefined on the legacy default', () => {
    expect(resolveHeadingSkin(headingRef, 1, registry)).toMatchObject({ status: 'resolved', definition: heading })
    expect(resolveBoxSkin(boxRef, 'concept', registry)).toMatchObject({ status: 'resolved', definition: box })
    expect(resolveHeadingSkin(undefined, 1, registry)).toEqual({ status: 'default' })
    expect(resolveBoxSkin(undefined, 'concept', registry)).toEqual({ status: 'default' })
  })

  it('falls back without mutating missing and incompatible refs', () => {
    const missing = { id: 'custom.heading.removed', version: 3 }
    expect(resolveHeadingSkin(missing, 1, registry)).toEqual({ status: 'missing', skin: missing })
    expect(resolveHeadingSkin(headingRef, 2, registry)).toEqual({ status: 'incompatible', skin: headingRef })
    expect(resolveBoxSkin(boxRef, 'warning', registry)).toEqual({ status: 'incompatible', skin: boxRef })
  })
})

describe('TeachingSkinRef persistence contract', () => {
  it('accepts JSON-safe settings and retains unknown IDs verbatim', () => {
    const raw = { id: 'custom.heading.future', version: 7, settings: { density: 'compact', nested: { enabled: true } } }
    expect(parseTeachingSkinRef(raw)).toEqual(raw)
  })

  it('rejects executable presentation keys from persisted settings', () => {
    expect(parseTeachingSkinRef({ id: 'custom.heading.future', settings: { className: 'unsafe' } })).toBeUndefined()
    expect(parseTeachingSkinRef({ id: 'custom.heading.future', settings: { style: { color: 'red' } } })).toBeUndefined()
    expect(parseTeachingSkinRef({ id: 'custom.heading.future', settings: { nested: { html: '<b>unsafe</b>' } } })).toBeUndefined()
  })
})
