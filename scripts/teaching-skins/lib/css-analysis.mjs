import fs from 'node:fs/promises'
import postcss from 'postcss'

function issue(kind, code, file, message) {
  return { kind, code, file, message }
}

function hasAncestorKeyframes(node) {
  let current = node.parent
  while (current) {
    if (current.type === 'atrule' && /keyframes$/i.test(current.name)) return true
    current = current.parent
  }
  return false
}

export async function analyzeSkinCss(file, className) {
  const source = await fs.readFile(file, 'utf8')
  const errors = []
  const warnings = []
  let root
  try {
    root = postcss.parse(source, { from: file })
  } catch (error) {
    return { errors: [issue('error', 'css-parse', file, error instanceof Error ? error.message : 'Invalid CSS.')], warnings }
  }
  const scope = `.${className}`
  root.walkAtRules((rule) => {
    const name = rule.name.toLowerCase()
    if (name === 'import' && /https?:/i.test(rule.params)) errors.push(issue('error', 'remote-css-import', file, 'Remote CSS imports are not allowed.'))
    if (name.endsWith('keyframes')) errors.push(issue('error', 'keyframes', file, 'Skin CSS cannot define keyframes.'))
    if (name === 'media' && !/\bprint\b/i.test(rule.params)) warnings.push(issue('warning', 'non-print-media', file, 'Non-print media queries require a manual layout check.'))
  })
  root.walkRules((rule) => {
    if (hasAncestorKeyframes(rule)) return
    for (const selector of postcss.list.comma(rule.selector)) {
      const trimmed = selector.trim()
      if (!trimmed.includes(scope)) errors.push(issue('error', 'unscoped-selector', file, `Selector must include ${scope}: ${trimmed}`))
      if (/(?:^|[\s>+~])(?:html|body)(?=[\s.#[:>+~]|$)|\.ProseMirror\b|\.td-document\b|\.td-heading\b|\[data-(?:block-id|block-type|teaching-)/.test(trimmed)) {
        errors.push(issue('error', 'core-selector', file, `Selector touches protected editor or layout DOM: ${trimmed}`))
      }
      if (/\.td-box(?!-(?:header|body)\b)/.test(trimmed) || /\.td-(?:pagination|paper|page)\b/.test(trimmed)) {
        errors.push(issue('error', 'core-selector', file, `Selector touches protected box or page layout DOM: ${trimmed}`))
      }
      if (/:hover\b|:focus\b/.test(trimmed)) warnings.push(issue('warning', 'interactive-selector', file, `Interactive selector needs a non-interactive fallback: ${trimmed}`))
    }
  })
  root.walkDecls((declaration) => {
    const property = declaration.prop.toLowerCase()
    const value = declaration.value.toLowerCase()
    if (property === 'position' && /\b(?:fixed|sticky)\b/.test(value)) errors.push(issue('error', 'position', file, `${property}: ${value} is not allowed.`))
    if (property === 'position' && /\babsolute\b/.test(value)) warnings.push(issue('warning', 'absolute-position', file, 'Absolute positioning needs a page-boundary check.'))
    if (property === 'overflow' && /\b(?:auto|scroll)\b/.test(value)) errors.push(issue('error', 'overflow-scroll', file, `${property}: ${value} is not allowed.`))
    if (/^(?:break-(?:before|after|inside)|page-break-(?:before|after|inside))$/.test(property)) errors.push(issue('error', 'pagination-property', file, `${property} is not allowed in skins.`))
    if (property === 'animation' || property === 'animation-name') errors.push(issue('error', 'animation', file, `${property} is not allowed in skins.`))
    if (/url\(\s*['\"]?https?:/i.test(declaration.value)) errors.push(issue('error', 'external-url', file, 'External http/https assets are not allowed.'))
    if (/(?:^|[^\w-])(?:\d*\.?\d+)(?:dvh|svh|lvh|vh|vw)(?:$|[^\w-])/.test(value)) errors.push(issue('error', 'viewport-unit', file, 'Viewport-relative dimensions are not allowed.'))
    if (/^margin(?:-(?:top|right|bottom|left))?$/.test(property) && /(?:^|\s)-\d/.test(value)) warnings.push(issue('warning', 'negative-margin', file, 'Large negative margins require a manual page-boundary check.'))
    if (property === 'filter' || property === 'backdrop-filter') warnings.push(issue('warning', 'filter', file, `${property} requires a manual print check.`))
    if (property === 'transform' && value !== 'none') warnings.push(issue('warning', 'transform', file, 'Transforms can create page-boundary risk.'))
  })
  return { errors, warnings }
}
