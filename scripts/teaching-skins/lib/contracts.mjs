export const SKIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/
export const CLASS_NAME_PATTERN = /^[a-z_][a-z0-9_-]*$/
export const AUTHORING_IMPORT = '@/utils/teachingDocument/skins/authoring'
export const TEACHING_SKIN_TOKEN_KINDS = ['color', 'spacing', 'radius', 'border']
export const MAX_TEACHING_SKIN_TOKEN_PX = 96
export const MAX_TEACHING_SKIN_BORDER_WIDTH_PX = 12

const LOCAL_DESIGN_ID_PATTERN = /^[a-z][A-Za-z0-9]*$/
const CANONICAL_HEX_PATTERN = /^#[0-9A-F]{6}$/
const BORDER_STYLES = new Set(['solid', 'dashed', 'dotted'])

export function isStableSkinId(value) {
  return typeof value === 'string' && SKIN_ID_PATTERN.test(value)
}

export function isLocalDesignId(value) {
  return typeof value === 'string' && LOCAL_DESIGN_ID_PATTERN.test(value)
}

export function presetDefinitionShapeIssues(preset) {
  const issues = []
  if (!hasExactKeys(preset, ['apiVersion', 'id', 'version', 'label', 'description', 'bindings', 'recommendedSkins'])) return ['Preset may use only apiVersion, id, version, label, description, bindings, and recommendedSkins.']
  if (preset.apiVersion !== 1) issues.push('Preset apiVersion must be 1.')
  if (!isStableSkinId(preset.id)) issues.push('Preset ID must be a stable namespaced lowercase identifier.')
  if (!Number.isInteger(preset.version) || preset.version < 1) issues.push('Preset version must be a positive integer.')
  if (!nonEmptyString(preset.label)) issues.push('Preset label is required.')
  if (preset.description !== undefined && !nonEmptyString(preset.description)) issues.push('Preset description must be a non-empty string when provided.')
  if (!preset.bindings || typeof preset.bindings !== 'object' || Array.isArray(preset.bindings) || !Object.keys(preset.bindings).length) issues.push('Preset bindings must be a non-empty static object.')
  else for (const [skinId, variantId] of Object.entries(preset.bindings)) {
    if (!isStableSkinId(skinId)) issues.push('Preset binding keys must be stable Skin IDs.')
    if (!isLocalDesignId(variantId)) issues.push('Preset binding values must be stable Skin-local Variant IDs.')
  }
  if (preset.recommendedSkins !== undefined) {
    if (!preset.recommendedSkins || typeof preset.recommendedSkins !== 'object' || Array.isArray(preset.recommendedSkins)
      || !hasExactKeys(preset.recommendedSkins, ['heading', 'box'])) {
      issues.push('Preset recommendedSkins may use only heading and box stable Skin IDs.')
    } else {
      for (const skinId of Object.values(preset.recommendedSkins)) {
        if (!isStableSkinId(skinId)) issues.push('Preset recommendedSkins values must be stable Skin IDs.')
      }
    }
  }
  return issues
}

export function presetReferenceIssues(preset, skinDefinitions) {
  if (!preset?.bindings || typeof preset.bindings !== 'object' || Array.isArray(preset.bindings)) return []
  const issues = []
  for (const [skinId, variantId] of Object.entries(preset.bindings)) {
    const skin = skinDefinitions.get(skinId)
    if (!skin) { issues.push(`Preset binding references missing Skin ${skinId}.`); continue }
    if (!skin.design) { issues.push(`Preset binding Skin ${skinId} has no design metadata.`); continue }
    if (!Array.isArray(skin.design.variants) || !skin.design.variants.some((variant) => variant?.id === variantId)) issues.push(`Preset binding ${skinId} references missing Variant ${variantId}.`)
  }
  const recommended = preset.recommendedSkins
  if (!recommended || typeof recommended !== 'object' || Array.isArray(recommended)) return issues
  for (const target of ['heading', 'box']) {
    const skinId = recommended[target]
    if (skinId === undefined) continue
    const skin = skinDefinitions.get(skinId)
    if (!skin) {
      issues.push(`Preset recommended ${target} Skin ${skinId} is missing.`)
      continue
    }
    if (skin.target !== target) issues.push(`Preset recommended ${target} Skin ${skinId} has target ${skin.target}.`)
    if (!Object.prototype.hasOwnProperty.call(preset.bindings, skinId)) {
      issues.push(`Preset recommended ${target} Skin ${skinId} must also appear in bindings.`)
    }
  }
  return issues
}

function hasExactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function nonEmptyString(value) {
  return typeof value === 'string' && Boolean(value.trim())
}

function boundedPx(value, maximum) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum
}

function array(value) {
  return Array.isArray(value) ? value : null
}

function designTokens(design) {
  return array(design?.tokens) || []
}

function designSlots(design) {
  return array(design?.slots) || []
}

function designVariants(design) {
  return array(design?.variants) || []
}

export function tokenDefinitionShapeIssues(token) {
  const issues = []
  if (!hasExactKeys(token, ['id', 'kind', 'label', 'printSafe', 'value'])) return ['Token may use only id, kind, label, printSafe, and value.']
  if (!isStableSkinId(token.id)) issues.push('Token ID must be a stable namespaced lowercase identifier.')
  if (!TEACHING_SKIN_TOKEN_KINDS.includes(token.kind)) issues.push('Token kind must be color, spacing, radius, or border.')
  if (!nonEmptyString(token.label)) issues.push('Token label is required.')
  if (token.printSafe !== true) issues.push('Token printSafe must be true.')
  if (!token.value || typeof token.value !== 'object' || Array.isArray(token.value)) return [...issues, 'Token value must be an object.']
  if (token.kind === 'color') {
    if (!hasExactKeys(token.value, ['hex']) || typeof token.value.hex !== 'string' || !CANONICAL_HEX_PATTERN.test(token.value.hex)) {
      issues.push('Color Token value must be canonical uppercase #RRGGBB.')
    }
  } else if (token.kind === 'spacing' || token.kind === 'radius') {
    if (!hasExactKeys(token.value, ['px']) || !boundedPx(token.value.px, MAX_TEACHING_SKIN_TOKEN_PX)) {
      issues.push(`${token.kind} Token value.px must be finite, non-negative, and at most ${MAX_TEACHING_SKIN_TOKEN_PX}.`)
    }
  } else if (token.kind === 'border') {
    if (!hasExactKeys(token.value, ['widthPx', 'style', 'colorTokenId'])
      || !boundedPx(token.value.widthPx, MAX_TEACHING_SKIN_BORDER_WIDTH_PX)
      || !BORDER_STYLES.has(token.value.style)
      || !isStableSkinId(token.value.colorTokenId)) {
      issues.push(`Border Token requires widthPx (0-${MAX_TEACHING_SKIN_BORDER_WIDTH_PX}), style solid/dashed/dotted, and a stable colorTokenId.`)
    }
  }
  return issues
}

function slotShapeIssues(slot) {
  const issues = []
  if (!hasExactKeys(slot, ['id', 'kind', 'defaultTokenId', 'allowedTokenIds'])) return ['Slot may use only id, kind, defaultTokenId, and allowedTokenIds.']
  if (!isLocalDesignId(slot.id)) issues.push('Slot ID must be a stable local lowerCamelCase identifier.')
  if (!TEACHING_SKIN_TOKEN_KINDS.includes(slot.kind)) issues.push('Slot kind must be color, spacing, radius, or border.')
  if (!isStableSkinId(slot.defaultTokenId)) issues.push('Slot defaultTokenId must be a stable Token ID.')
  if (slot.allowedTokenIds !== undefined) {
    if (!Array.isArray(slot.allowedTokenIds) || !slot.allowedTokenIds.length || slot.allowedTokenIds.some((id) => !isStableSkinId(id))) {
      issues.push('Slot allowedTokenIds must be a non-empty list of stable Token IDs.')
    } else if (new Set(slot.allowedTokenIds).size !== slot.allowedTokenIds.length) {
      issues.push('Slot allowedTokenIds cannot contain duplicates.')
    }
  }
  return issues
}

function variantShapeIssues(variant) {
  const issues = []
  if (!hasExactKeys(variant, ['id', 'label', 'description', 'tokenBindings'])) return ['Variant may use only id, label, description, and tokenBindings.']
  if (!isLocalDesignId(variant.id)) issues.push('Variant ID must be a stable local lowerCamelCase identifier.')
  if (!nonEmptyString(variant.label)) issues.push('Variant label is required.')
  if (variant.description !== undefined && !nonEmptyString(variant.description)) issues.push('Variant description must be a non-empty string when provided.')
  if (!variant.tokenBindings || typeof variant.tokenBindings !== 'object' || Array.isArray(variant.tokenBindings) || !Object.keys(variant.tokenBindings).length) {
    issues.push('Variant tokenBindings must be a non-empty static object.')
  } else if (Object.values(variant.tokenBindings).some((tokenId) => !isStableSkinId(tokenId))) {
    issues.push('Variant tokenBindings values must be stable Token IDs.')
  }
  return issues
}

/** Shape-only validation shared by skin:check; cross-Skin references are checked separately. */
export function designMetadataShapeIssues(design) {
  if (!design || typeof design !== 'object' || Array.isArray(design)) return ['design must be an object.']
  const issues = []
  if (!hasExactKeys(design, ['tokens', 'slots', 'variants'])) issues.push('design may use only tokens, slots, and variants; defaultVariantId is not supported.')
  if (!Array.isArray(design.slots)) issues.push('design.slots is required and must be an array.')
  if (design.tokens !== undefined && !Array.isArray(design.tokens)) issues.push('design.tokens must be an array when provided.')
  if (design.variants !== undefined && !Array.isArray(design.variants)) issues.push('design.variants must be an array when provided.')
  for (const token of designTokens(design)) issues.push(...tokenDefinitionShapeIssues(token))
  for (const slot of designSlots(design)) issues.push(...slotShapeIssues(slot))
  for (const variant of designVariants(design)) issues.push(...variantShapeIssues(variant))
  const tokenIds = designTokens(design).map((token) => token?.id).filter((id) => typeof id === 'string')
  const slotIds = designSlots(design).map((slot) => slot?.id).filter((id) => typeof id === 'string')
  const variantIds = designVariants(design).map((variant) => variant?.id).filter((id) => typeof id === 'string')
  if (new Set(tokenIds).size !== tokenIds.length) issues.push('design.tokens cannot contain duplicate Token IDs.')
  if (new Set(slotIds).size !== slotIds.length) issues.push('design.slots cannot contain duplicate Slot IDs.')
  if (new Set(variantIds).size !== variantIds.length) issues.push('design.variants cannot contain duplicate Variant IDs.')
  return issues
}

/** Cross-definition validation performed only after all auto-discovered Token contributions are known. */
export function designMetadataReferenceIssues(design, tokenIndex) {
  if (!design || typeof design !== 'object' || Array.isArray(design)) return []
  const issues = []
  const resolveToken = (id, expectedKind, trail = new Set()) => {
    const contributions = tokenIndex.get(id) || []
    if (!contributions.length) return { ok: false, message: `Token ${String(id)} is unknown.` }
    if (contributions.length !== 1) return { ok: false, message: `Token ${String(id)} is ambiguous because it has ${contributions.length} definitions.` }
    const contribution = contributions[0]
    if (contribution.shapeIssues.length) {
      return { ok: false, message: `Token ${String(id)} is invalid: ${contribution.shapeIssues.join(' ')}` }
    }
    const { token } = contribution
    if (expectedKind && token.kind !== expectedKind) {
      return { ok: false, message: `Token ${String(id)} must be a ${expectedKind} Token.` }
    }
    if (token.kind === 'border') {
      if (trail.has(id)) return { ok: false, message: `Border Token ${String(id)} has a cyclic color dependency.` }
      const color = resolveToken(token.value.colorTokenId, 'color', new Set([...trail, id]))
      if (!color.ok) return { ok: false, message: `Border Token ${String(id)} colorTokenId is invalid: ${color.message}` }
    }
    return { ok: true, token }
  }
  for (const token of designTokens(design)) {
    if (!token || typeof token !== 'object' || token.kind !== 'border') continue
    const resolved = resolveToken(token.id, 'border')
    if (!resolved.ok) issues.push(`Border Token ${String(token.id)} dependency error: ${resolved.message}`)
  }
  const slotsById = new Map(designSlots(design)
    .filter((slot) => slot && typeof slot === 'object' && !Array.isArray(slot))
    .map((slot) => [slot.id, slot]))
  for (const slot of slotsById.values()) {
    const defaultToken = resolveToken(slot.defaultTokenId, slot.kind)
    if (!defaultToken.ok) issues.push(`Slot ${String(slot.id)} defaultTokenId dependency error: ${defaultToken.message}`)
    const allowedTokenIds = Array.isArray(slot.allowedTokenIds) ? slot.allowedTokenIds : null
    if (!allowedTokenIds) continue
    for (const tokenId of allowedTokenIds) {
      const token = resolveToken(tokenId, slot.kind)
      if (!token.ok) issues.push(`Slot ${String(slot.id)} allowedTokenIds dependency error: ${token.message}`)
    }
    if (!allowedTokenIds.includes(slot.defaultTokenId)) issues.push(`Slot ${String(slot.id)} allowedTokenIds must include defaultTokenId.`)
  }
  for (const variant of designVariants(design)) {
    if (!variant || typeof variant !== 'object' || Array.isArray(variant)
      || !variant.tokenBindings || typeof variant.tokenBindings !== 'object' || Array.isArray(variant.tokenBindings)) continue
    for (const [slotId, tokenId] of Object.entries(variant.tokenBindings)) {
      const slot = slotsById.get(slotId)
      if (!slot) {
        issues.push(`Variant ${String(variant.id)} binds undeclared Slot ${slotId}.`)
        continue
      }
      const token = resolveToken(tokenId, slot.kind)
      if (!token.ok) issues.push(`Variant ${String(variant.id)} Token ${tokenId} dependency error: ${token.message}`)
      const allowedTokenIds = Array.isArray(slot.allowedTokenIds) ? slot.allowedTokenIds : null
      if (token.ok && allowedTokenIds && !allowedTokenIds.includes(tokenId)) {
        issues.push(`Variant ${String(variant.id)} Token ${tokenId} is not allowed for Slot ${slotId}.`)
      }
    }
  }
  return issues
}

export function tokensFromSkinDefinition(definition) {
  return designTokens(definition?.design)
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
  if (definition.design !== undefined) issues.push(...designMetadataShapeIssues(definition.design))
  return issues
}
