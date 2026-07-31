import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { createHash } from 'node:crypto'
import { RouteError } from '../../utils/http-error.js'

const MAX_BYTES = 5 * 1024 * 1024
const MAX_NODES = 10_000
const MAX_DEPTH = 64
const MAX_PATH_DATA = 500_000
const MAX_VIEWPORT = 20_000
const ALLOWED_ELEMENTS = new Set(['svg', 'g', 'defs', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc', 'use', 'symbol', 'marker', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'stop', 'pattern', 'image'])

export type SanitizedSvg = { content: Buffer; width: number; height: number; sha256: string }

function numberValue(value: string | null, fallback = 0) {
  const match = String(value || '').trim().match(/^([0-9]+(?:\.[0-9]+)?)(?:px|pt|mm|cm|in)?$/i)
  return match ? Number(match[1]) : fallback
}

function unsafeUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith('#')) return false
  return /^(?:javascript:|data:|https?:|ftp:|file:|\/\/)/i.test(trimmed) || !trimmed.startsWith('#')
}

/** Parse, validate and reserialize an SVG. This deliberately rejects ambiguity
 * instead of attempting to preserve executable or remote-resource constructs. */
export function sanitizeSvg(input: Buffer): SanitizedSvg {
  if (!input.length || input.length > MAX_BYTES) throw new RouteError(400, 'SVG 文件为空或超过 5MB 限制。')
  const text = input.toString('utf8')
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new RouteError(400, 'SVG 不允许包含 DOCTYPE 或实体声明。')
  const document = new DOMParser({ errorHandler: { warning() {}, error() {}, fatalError() {} } }).parseFromString(text, 'image/svg+xml')
  const root = document.documentElement
  if (!root || root.nodeName.toLowerCase() !== 'svg' || document.getElementsByTagName('parsererror').length) throw new RouteError(400, 'SVG XML 格式无效。')
  let nodes = 0
  const inspect = (element: Element, depth: number) => {
    nodes += 1
    if (nodes > MAX_NODES || depth > MAX_DEPTH) throw new RouteError(400, 'SVG 结构过于复杂。')
    const name = element.nodeName.replace(/^.*:/, '')
    if (!ALLOWED_ELEMENTS.has(name)) throw new RouteError(400, `SVG 不允许使用 ${name} 元素。`)
    for (let index = element.attributes.length - 1; index >= 0; index -= 1) {
      const attribute = element.attributes.item(index)!
      const key = attribute.name.toLowerCase()
      const value = attribute.value
      if (key.startsWith('on') || key === 'xml:base') throw new RouteError(400, 'SVG 不允许脚本事件或外部基准路径。')
      if (key === 'style' && (/url\s*\(/i.test(value) || /expression\s*\(|@import/i.test(value))) throw new RouteError(400, 'SVG 内联样式包含不允许的资源引用。')
      if ((key === 'href' || key === 'xlink:href') && unsafeUrl(value)) throw new RouteError(400, 'SVG 不允许外部或 data URL 资源。')
      if ((key === 'd' && value.length > MAX_PATH_DATA) || /url\s*\(/i.test(value) && !/url\s*\(\s*#[-\w.]+\s*\)/i.test(value)) throw new RouteError(400, 'SVG 包含不允许的路径或资源引用。')
    }
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) inspect(child as Element, depth + 1)
      if (child.nodeType === 4 || child.nodeType === 5 || child.nodeType === 6) throw new RouteError(400, 'SVG 不允许实体节点。')
    }
  }
  inspect(root, 1)
  const viewBox = root.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number) || []
  let width = numberValue(root.getAttribute('width'))
  let height = numberValue(root.getAttribute('height'))
  if ((!width || !height) && viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    width = width || Math.round(viewBox[2]); height = height || Math.round(viewBox[3])
  }
  if (!width || !height || width > MAX_VIEWPORT || height > MAX_VIEWPORT || width * height > 60_000_000) throw new RouteError(400, 'SVG 画布尺寸无效或过大。')
  if (!root.getAttribute('viewBox')) root.setAttribute('viewBox', `0 0 ${width} ${height}`)
  root.setAttribute('width', String(Math.round(width)))
  root.setAttribute('height', String(Math.round(height)))
  const content = Buffer.from(new XMLSerializer().serializeToString(document), 'utf8')
  return { content, width: Math.round(width), height: Math.round(height), sha256: `sha256:${createHash('sha256').update(content).digest('hex')}` }
}
