import { describe, expect, it } from 'vitest'
import { TEACHING_DOM, waitForRenderReadiness } from '.'

const immediateFrame = (callback: FrameRequestCallback) => {
  callback(0)
  return 1
}

describe('waitForRenderReadiness', () => {
  it('transitions from a pending question resolver to a stable ready layout', async () => {
    const root = document.createElement('div')
    const question = document.createElement('div')
    question.setAttribute(TEACHING_DOM.resource, 'question')
    question.setAttribute(TEACHING_DOM.resourceId, 'question-block')
    question.setAttribute(TEACHING_DOM.resourceStatus, 'loading')
    root.append(question)

    const waiting = waitForRenderReadiness(root, {
      timeoutMs: 100,
      stableFrames: 1,
      requestFrame: immediateFrame,
    })
    question.setAttribute(TEACHING_DOM.resourceStatus, 'ready')
    const result = await waiting
    expect(result.ready).toBe(true)
    expect(result.pendingQuestions).toEqual([])
    expect(result.diagnostics).toEqual([])
  })

  it('treats a failed image as settled and reports its resource ID', async () => {
    const root = document.createElement('div')
    const image = document.createElement('img')
    image.setAttribute(TEACHING_DOM.resourceId, 'broken-image')
    Object.defineProperty(image, 'complete', { configurable: true, value: true })
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 0 })
    root.append(image)

    const result = await waitForRenderReadiness(root, {
      timeoutMs: 100,
      stableFrames: 1,
      requestFrame: immediateFrame,
    })
    expect(result.ready).toBe(true)
    expect(result.failedImages).toEqual(['broken-image'])
    expect(result.pendingImages).toEqual([])
  })

  it('stops at a finite timeout and emits a resource diagnostic', async () => {
    const root = document.createElement('div')
    const figure = document.createElement('div')
    figure.setAttribute(TEACHING_DOM.resource, 'figure-resolver')
    figure.setAttribute(TEACHING_DOM.resourceId, 'pending-figure')
    figure.setAttribute(TEACHING_DOM.resourceStatus, 'loading')
    root.append(figure)

    const result = await waitForRenderReadiness(root, {
      timeoutMs: 5,
      stableFrames: 1,
      requestFrame: immediateFrame,
    })
    expect(result.ready).toBe(false)
    expect(result.timedOut).toBe(true)
    expect(result.pendingFigures).toEqual(['pending-figure'])
    expect(result.diagnostics[0].code).toBe('resource-timeout')
  })

  it('stops waiting when an animation frame is never delivered', async () => {
    const root = document.createElement('div')
    const result = await waitForRenderReadiness(root, {
      timeoutMs: 5,
      stableFrames: 1,
      requestFrame: () => 1,
    })

    expect(result.ready).toBe(false)
    expect(result.timedOut).toBe(true)
    expect(result.diagnostics[0].code).toBe('unstable-layout')
  })

  it('stops waiting for a frame as soon as the layout request is aborted', async () => {
    const root = document.createElement('div')
    const controller = new AbortController()
    const waiting = waitForRenderReadiness(root, {
      timeoutMs: 1_000,
      stableFrames: 1,
      signal: controller.signal,
      requestFrame: () => 1,
    })

    controller.abort()
    const result = await waiting
    expect(result.ready).toBe(false)
    expect(result.timedOut).toBe(false)
  })
})
