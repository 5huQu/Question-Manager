export const SKIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/
export const CLASS_NAME_PATTERN = /^[a-z_][a-z0-9_-]*$/
export const AUTHORING_IMPORT = '@/utils/teachingDocument/skins/authoring'

export function isStableSkinId(value) {
  return typeof value === 'string' && SKIN_ID_PATTERN.test(value)
}

export function skinDirectorySlug(id) {
  return id.replace(/[._]+/g, '-').replace(/[^a-z0-9-]/g, '-')
}

export function classNameForSkinId(id) {
  return `td-skin-${skinDirectorySlug(id)}`
}

export function parseCommaList(value, { label, allowed } = {}) {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`${label || 'Value'} must be a comma-separated string.`)
  const items = value.split(',').map((item) => item.trim())
  if (!items.length || items.some((item) => !item)) throw new Error(`${label || 'Value'} cannot contain an empty item.`)
  if (new Set(items).size !== items.length) throw new Error(`${label || 'Value'} cannot contain duplicates.`)
  if (allowed && items.some((item) => !allowed.includes(item))) {
    throw new Error(`${label || 'Value'} must use only: ${allowed.join(', ')}.`)
  }
  return items
}

export function validateNewSkinOptions(options) {
  const { target, id, label, preset } = options
  if (target !== 'heading' && target !== 'box') throw new Error('Target must be "heading" or "box".')
  if (!isStableSkinId(id)) throw new Error('ID must be a stable namespaced lowercase identifier, such as studio.heading.lesson-title.')
  if (!String(label || '').trim()) throw new Error('Label is required.')
  const allowedPresets = target === 'heading'
    ? ['minimal', 'left-accent', 'pill']
    : ['minimal', 'left-accent', 'header-band']
  if (!allowedPresets.includes(preset || 'minimal')) {
    throw new Error(`Preset for ${target} must be one of: ${allowedPresets.join(', ')}.`)
  }
  if (target === 'heading' && options.templates !== undefined) throw new Error('--templates is only valid for box skins.')
  if (target === 'box' && options.levels !== undefined) throw new Error('--levels is only valid for heading skins.')
  const levels = target === 'heading'
    ? parseCommaList(options.levels, { label: 'Heading levels', allowed: ['1', '2', '3', '4'] })?.map(Number)
    : undefined
  const templates = target === 'box'
    ? parseCommaList(options.templates, { label: 'Box templates' })
    : undefined
  return { ...options, label: label.trim(), preset: preset || 'minimal', levels, templates }
}

export function skinDefinitionShapeIssues(definition) {
  const issues = []
  if (!definition || typeof definition !== 'object') return ['default export must be a skin definition.']
  if (definition.apiVersion !== 1) issues.push('apiVersion must be 1.')
  if (!isStableSkinId(definition.id)) issues.push('ID must be a stable namespaced lowercase identifier.')
  if (definition.target !== 'heading' && definition.target !== 'box') issues.push('Target must be heading or box.')
  if (!String(definition.label || '').trim()) issues.push('Label is required.')
  if (!Number.isInteger(definition.version) || definition.version < 1) issues.push('Version must be a positive integer.')
  if (definition.printSafe !== true) issues.push('printSafe must be true in Phase 2A.')
  if (!CLASS_NAME_PATTERN.test(String(definition.className || ''))) issues.push('className must be one stable CSS class token.')
  if (definition.target === 'heading' && definition.supportedLevels !== undefined) {
    if (!Array.isArray(definition.supportedLevels) || definition.supportedLevels.some((level) => ![1, 2, 3, 4].includes(level))) {
      issues.push('supportedLevels must contain only 1, 2, 3, or 4.')
    } else if (new Set(definition.supportedLevels).size !== definition.supportedLevels.length) {
      issues.push('supportedLevels cannot contain duplicates.')
    }
  }
  if (definition.target === 'box' && definition.supportedTemplates !== undefined) {
    if (!Array.isArray(definition.supportedTemplates) || definition.supportedTemplates.some((item) => typeof item !== 'string' || !item.trim())) {
      issues.push('supportedTemplates must contain non-empty strings.')
    } else if (new Set(definition.supportedTemplates).size !== definition.supportedTemplates.length) {
      issues.push('supportedTemplates cannot contain duplicates.')
    }
  }
  return issues
}
