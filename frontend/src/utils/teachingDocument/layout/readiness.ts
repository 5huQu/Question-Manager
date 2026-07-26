import { TEACHING_DOM, TEACHING_DOM_SELECTORS } from './domContract'
import type { RenderDiagnostic, RenderReadinessResult } from './types'

export interface RenderReadinessOptions {
  timeoutMs?: number
  stableFrames?: number
  signal?: AbortSignal
  requestFrame?: (callback: FrameRequestCallback) => number
}

interface ResourceSnapshot {
  pendingImages: string[]
  pendingQuestions: string[]
  pendingFigures: string[]
  failedImages: string[]
}

function resourceId(element: Element, fallback: string) {
  return element.getAttribute(TEACHING_DOM.resourceId)
    || element.closest(`[${TEACHING_DOM.blockId}]`)?.getAttribute(TEACHING_DOM.blockId)
    || fallback
}

export function inspectRenderResources(root: HTMLElement): ResourceSnapshot {
  const pendingImages: string[] = []
  const failedImages: string[] = []
  const images = Array.from(root.querySelectorAll<HTMLImageElement>('img'))
  images.forEach((image, index) => {
    const id = resourceId(image, `image-${index}`)
    if (!image.complete) pendingImages.push(id)
    else if (image.naturalWidth <= 0) failedImages.push(id)
  })

  root.querySelectorAll<HTMLElement>(`${TEACHING_DOM_SELECTORS.imageResource}[${TEACHING_DOM.resourceStatus}="loading"]`)
    .forEach((element, index) => pendingImages.push(resourceId(element, `figure-image-${index}`)))
  root.querySelectorAll<HTMLElement>(`${TEACHING_DOM_SELECTORS.imageResource}[${TEACHING_DOM.resourceStatus}="error"]`)
    .forEach((element, index) => failedImages.push(resourceId(element, `failed-image-${index}`)))

  const pendingQuestions = Array.from(
    root.querySelectorAll<HTMLElement>(`${TEACHING_DOM_SELECTORS.questionResource}[${TEACHING_DOM.resourceStatus}="loading"]`),
    (element, index) => resourceId(element, `question-${index}`),
  )
  const pendingFigures = Array.from(
    root.querySelectorAll<HTMLElement>(`${TEACHING_DOM_SELECTORS.figureResolverResource}[${TEACHING_DOM.resourceStatus}="loading"]`),
    (element, index) => resourceId(element, `figure-${index}`),
  )

  return {
    pendingImages: [...new Set(pendingImages)],
    pendingQuestions: [...new Set(pendingQuestions)],
    pendingFigures: [...new Set(pendingFigures)],
    failedImages: [...new Set(failedImages)],
  }
}

function nextFrame(requestFrame: (callback: FrameRequestCallback) => number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve()
    requestFrame(() => resolve())
  })
}

async function waitForStableFrames(
  root: HTMLElement,
  count: number,
  requestFrame: (callback: FrameRequestCallback) => number,
  deadline: number,
  signal?: AbortSignal,
) {
  let stable = 0
  let previous = ''
  while (stable < count && Date.now() < deadline && !signal?.aborted) {
    await nextFrame(requestFrame, signal)
    const rect = root.getBoundingClientRect()
    const signature = [
      rect.width,
      rect.height,
      root.scrollWidth,
      root.scrollHeight,
      ...Array.from(root.querySelectorAll<HTMLElement>(TEACHING_DOM_SELECTORS.block))
        .flatMap((element) => {
          const blockRect = element.getBoundingClientRect()
          return [blockRect.width, blockRect.height]
        }),
    ].join('|')
    stable = signature === previous ? stable + 1 : 0
    previous = signature
  }
  return stable >= count
}

export async function waitForRenderReadiness(
  root: HTMLElement,
  options: RenderReadinessOptions = {},
): Promise<RenderReadinessResult> {
  const timeoutMs = Math.max(1, options.timeoutMs ?? 8_000)
  const stableFrames = Math.max(1, options.stableFrames ?? 2)
  const requestFrame = options.requestFrame
    || ((callback: FrameRequestCallback) => window.requestAnimationFrame(callback))
  const deadline = Date.now() + timeoutMs
  const fonts = root.ownerDocument.fonts
  let pendingFonts = Boolean(fonts && fonts.status !== 'loaded')
  let snapshot = inspectRenderResources(root)

  const resourcesReady = () => !pendingFonts
    && snapshot.pendingImages.length === 0
    && snapshot.pendingQuestions.length === 0
    && snapshot.pendingFigures.length === 0

  if (!resourcesReady() && !options.signal?.aborted) {
    await new Promise<void>((resolve) => {
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        observer.disconnect()
        clearTimeout(timer)
        root.querySelectorAll('img').forEach((image) => {
          image.removeEventListener('load', check)
          image.removeEventListener('error', check)
        })
        resolve()
      }
      const check = () => {
        snapshot = inspectRenderResources(root)
        if (resourcesReady() || options.signal?.aborted) finish()
      }
      const observer = new MutationObserver(check)
      observer.observe(root, { attributes: true, childList: true, subtree: true })
      root.querySelectorAll('img').forEach((image) => {
        image.addEventListener('load', check)
        image.addEventListener('error', check)
      })
      const timer = window.setTimeout(finish, Math.max(1, deadline - Date.now()))
      if (fonts) void fonts.ready.then(() => {
        pendingFonts = false
        check()
      })
      check()
    })
  }

  snapshot = inspectRenderResources(root)
  const resourcesSettled = resourcesReady()
  const layoutStable = resourcesSettled
    ? await waitForStableFrames(root, stableFrames, requestFrame, deadline, options.signal)
    : false
  const timedOut = !options.signal?.aborted && (!resourcesSettled || !layoutStable)
  const diagnostics: RenderDiagnostic[] = []
  if (!resourcesSettled) {
    diagnostics.push({
      code: 'resource-timeout',
      severity: 'error',
      message: `排版资源在 ${timeoutMs}ms 内未就绪。`,
    })
  } else if (!layoutStable) {
    diagnostics.push({
      code: 'unstable-layout',
      severity: 'warning',
      message: `资源已就绪，但布局未在 ${stableFrames} 个连续帧内稳定。`,
    })
  }

  return {
    ready: resourcesSettled && layoutStable && !options.signal?.aborted,
    timedOut,
    pendingFonts,
    pendingImages: snapshot.pendingImages,
    pendingQuestions: snapshot.pendingQuestions,
    pendingFigures: snapshot.pendingFigures,
    failedImages: snapshot.failedImages,
    diagnostics,
  }
}
