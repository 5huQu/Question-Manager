import type { JsonValue, TeachingSkinRef } from '@/types/teachingDocument'

export type TeachingSkinTarget = 'heading' | 'box'
export type HeadingSkinLevel = 1 | 2 | 3 | 4

export interface TeachingSkinDefinitionBase {
  apiVersion: 1
  /** Stable, namespaced identifier persisted in TeachingDocument JSON. */
  id: string
  target: TeachingSkinTarget
  label: string
  description?: string
  version: number
  author?: string
  tags?: readonly string[]
  /** Phase 1 skins must work in editor, A4 preview, and print. */
  printSafe: true
  /** CSS class added by the core renderer when this skin resolves. */
  className: string
}

export interface HeadingSkinDefinition extends TeachingSkinDefinitionBase {
  target: 'heading'
  supportedLevels?: readonly HeadingSkinLevel[]
}

export interface BoxSkinDefinition extends TeachingSkinDefinitionBase {
  target: 'box'
  supportedTemplates?: readonly string[]
}

export type TeachingSkinDefinition = HeadingSkinDefinition | BoxSkinDefinition

export type HeadingSkinInput = Omit<HeadingSkinDefinition, 'apiVersion' | 'target'>
export type BoxSkinInput = Omit<BoxSkinDefinition, 'apiVersion' | 'target'>

/** Define a declarative Heading skin without exposing a renderer API. */
export function defineHeadingSkin(definition: HeadingSkinInput): HeadingSkinDefinition {
  return { apiVersion: 1, target: 'heading', ...definition }
}

/** Define a declarative Box skin without exposing a renderer API. */
export function defineBoxSkin(definition: BoxSkinInput): BoxSkinDefinition {
  return { apiVersion: 1, target: 'box', ...definition }
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (!value || typeof value !== 'object') return false
  return Object.entries(value as Record<string, unknown>).every(([key, item]) => Boolean(key) && isJsonValue(item))
}

const SKIN_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/
const TEACHING_SKIN_REF_KEYS = new Set(['id', 'version', 'settings'])
const UNSAFE_SETTING_KEY = /^(?:css|cssText|html|react|className|class|style|script|component)$/i

function hasSafeSettings(value: unknown): value is Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.entries(value as Record<string, unknown>).every(([key, item]) => Boolean(key) && !UNSAFE_SETTING_KEY.test(key) && isSafeSettingsValue(item))
}

function isSafeSettingsValue(value: unknown): value is JsonValue {
  if (!isJsonValue(value)) return false
  if (Array.isArray(value)) return value.every(isSafeSettingsValue)
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).every(([key, item]) => !UNSAFE_SETTING_KEY.test(key) && isSafeSettingsValue(item))
  }
  return true
}

/** Parses only the persisted ref contract; it deliberately does not resolve IDs. */
export function parseTeachingSkinRef(value: unknown): TeachingSkinRef | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (Object.keys(raw).some((key) => !TEACHING_SKIN_REF_KEYS.has(key))) return undefined
  const id = typeof raw.id === 'string' ? raw.id : ''
  if (!SKIN_ID.test(id)) return undefined
  const version = raw.version
  if (version !== undefined && (!Number.isInteger(version) || Number(version) < 1)) return undefined
  if (raw.settings !== undefined && !hasSafeSettings(raw.settings)) return undefined
  return {
    id,
    ...(version !== undefined ? { version: Number(version) } : {}),
    ...(raw.settings !== undefined ? { settings: raw.settings } : {}),
  }
}

export function hasValidTeachingSkinRef(value: unknown): boolean {
  return value === undefined || parseTeachingSkinRef(value) !== undefined
}

export function isTeachingSkinDefinition(value: unknown): value is TeachingSkinDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const definition = value as Partial<TeachingSkinDefinition>
  if (definition.apiVersion !== 1 || !SKIN_ID.test(String(definition.id || ''))) return false
  if (definition.target !== 'heading' && definition.target !== 'box') return false
  if (!String(definition.label || '').trim() || !Number.isInteger(definition.version) || Number(definition.version) < 1) return false
  if (definition.printSafe !== true || !String(definition.className || '').trim()) return false
  if (definition.target === 'heading' && definition.supportedLevels !== undefined
    && (!Array.isArray(definition.supportedLevels) || definition.supportedLevels.some((level) => ![1, 2, 3, 4].includes(level)))) return false
  if (definition.target === 'box' && definition.supportedTemplates !== undefined
    && (!Array.isArray(definition.supportedTemplates) || definition.supportedTemplates.some((template) => typeof template !== 'string' || !template.trim()))) return false
  return true
}
