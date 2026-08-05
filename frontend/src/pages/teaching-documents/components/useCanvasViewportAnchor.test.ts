import { afterEach, describe, expect, it } from 'vitest'
import {
  captureCanvasViewportAnchor,
  restoreCanvasViewportAnchor,
} from './useCanvasViewportAnchor'

function rect(top: number, height: number, left = 0, width = 800): DOMRect {
  return {
    x: left,
    y: top,
    top,
    right: left + width,
    bottom: top + height,
    left,
    width,
    height,
    toJSON: () => ({}),
  }
}

describe('canvas viewport anchor', () => {
  afterEach(() => document.body.replaceChildren())

  it('keeps the visible point of a selected block fixed after canvas scaling', () => {
    const scrollRoot = document.createElement('section')
    const block = document.createElement('div')
    block.dataset.blockId = 'question-17'
    scrollRoot.appendChild(block)
    document.body.appendChild(scrollRoot)
    scrollRoot.scrollTop = 1000
    scrollRoot.getBoundingClientRect = () => rect(100, 600)
    block.getBoundingClientRect = () => rect(300, 200)

    const anchor = captureCanvasViewportAnchor(scrollRoot, 'question-17')
    expect(anchor).toMatchObject({ elementRatioY: 0.5, viewportY: 400 })

    block.getBoundingClientRect = () => rect(200, 100)
    expect(restoreCanvasViewportAnchor(scrollRoot, anchor!)).toBe(true)
    expect(scrollRoot.scrollTop).toBe(850)
  })

  it('anchors the center of the visible slice for a block taller than the viewport', () => {
    const scrollRoot = document.createElement('section')
    const block = document.createElement('div')
    block.dataset.blockId = 'long-question'
    scrollRoot.appendChild(block)
    document.body.appendChild(scrollRoot)
    scrollRoot.getBoundingClientRect = () => rect(100, 600)
    block.getBoundingClientRect = () => rect(0, 900)

    const anchor = captureCanvasViewportAnchor(scrollRoot, 'long-question')
    expect(anchor?.viewportY).toBe(400)
    expect(anchor?.elementRatioY).toBeCloseTo(4 / 9)
  })

  it('does not pull an offscreen selection back into view', () => {
    const scrollRoot = document.createElement('section')
    const block = document.createElement('div')
    block.dataset.blockId = 'offscreen-question'
    scrollRoot.appendChild(block)
    document.body.appendChild(scrollRoot)
    scrollRoot.getBoundingClientRect = () => rect(100, 600)
    block.getBoundingClientRect = () => rect(800, 100)

    expect(captureCanvasViewportAnchor(scrollRoot, 'offscreen-question')).toBeNull()
  })

  it('ignores duplicate blocks in the hidden pagination measurement tree', () => {
    const scrollRoot = document.createElement('section')
    const measureRoot = document.createElement('div')
    const measuredBlock = document.createElement('div')
    const visibleBlock = document.createElement('div')
    measureRoot.dataset.teachingMeasureRoot = ''
    measuredBlock.dataset.blockId = 'question-17'
    visibleBlock.dataset.blockId = 'question-17'
    measureRoot.appendChild(measuredBlock)
    scrollRoot.append(measureRoot, visibleBlock)
    document.body.appendChild(scrollRoot)
    scrollRoot.getBoundingClientRect = () => rect(100, 600)
    measuredBlock.getBoundingClientRect = () => rect(200, 100)
    visibleBlock.getBoundingClientRect = () => rect(300, 200)

    expect(captureCanvasViewportAnchor(scrollRoot, 'question-17')?.element).toBe(visibleBlock)
  })
})
