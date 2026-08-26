import type { TeachingSkinPresetRef } from '@/types/teachingDocument'
import { isTeachingSkinDefinition, isTeachingSkinLocalDesignId, type TeachingSkinVariantId } from './types'
import type { TeachingSkinRegistry } from './registry'

const STABLE_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/
const PRESET_KEYS = new Set(['apiVersion', 'id', 'version', 'label', 'description', 'bindings', 'recommendedSkins'])
const PRESET_REF_KEYS = new Set(['id', 'version'])

export interface TeachingSkinPresetRecommendedSkins {
  heading?: string
  box?: string
}

export interface TeachingSkinPresetDefinition {
  apiVersion: 1
  id: string
  version: number
  label: string
  description?: string
  bindings: Readonly<Record<string, TeachingSkinVariantId>>
  /** Source-only hints for the explicit Recommended Style Setup transaction. */
  recommendedSkins?: Readonly<TeachingSkinPresetRecommendedSkins>
}

export type TeachingSkinPresetInput = Omit<TeachingSkinPresetDefinition, 'apiVersion'>

/** Side-effect-free source authoring helper. Presets only compose exact Skin → Variant IDs. */
export function defineTeachingSkinPreset(definition: TeachingSkinPresetInput): TeachingSkinPresetDefinition {
  return { apiVersion: 1, ...definition }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isTeachingSkinPresetRecommendedSkins(value: unknown): value is TeachingSkinPresetRecommendedSkins {
  if (!isPlainObject(value) || Object.keys(value).some((key) => key !== 'heading' && key !== 'box')) return false
  return Object.values(value).every((skinId) => typeof skinId === 'string' && STABLE_ID.test(skinId))
}

/** Runtime defensive guard for source definitions and test/HMR mutation. */
export function isTeachingSkinPresetDefinition(value: unknown): value is TeachingSkinPresetDefinition {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !PRESET_KEYS.has(key))) return false
  if (value.apiVersion !== 1 || typeof value.id !== 'string' || !STABLE_ID.test(value.id)
    || !Number.isInteger(value.version) || Number(value.version) < 1
    || typeof value.label !== 'string' || !value.label.trim()
    || (value.description !== undefined && (typeof value.description !== 'string' || !value.description.trim()))
    || !isPlainObject(value.bindings)
    || (value.recommendedSkins !== undefined && !isTeachingSkinPresetRecommendedSkins(value.recommendedSkins))) return false
  const bindings = Object.entries(value.bindings)
  return bindings.length > 0 && bindings.every(([skinId, variantId]) => STABLE_ID.test(skinId) && isTeachingSkinLocalDesignId(variantId))
}

/** Persistence is structural and deliberately does not perform a registry lookup. */
export function parseTeachingSkinPresetRef(value: unknown): TeachingSkinPresetRef | undefined {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !PRESET_REF_KEYS.has(key))) return undefined
  if (typeof value.id !== 'string' || !STABLE_ID.test(value.id) || !Number.isInteger(value.version) || Number(value.version) < 1) return undefined
  return { id: value.id, version: Number(value.version) }
}

export class TeachingSkinPresetRegistry {
  private readonly definitions = new Map<string, Map<number, TeachingSkinPresetDefinition>>()

  register(definition: TeachingSkinPresetDefinition): void {
    if (!isTeachingSkinPresetDefinition(definition)) throw new Error('Teaching Skin Preset definitions must satisfy the source contract.')
    const versions = this.definitions.get(definition.id) ?? new Map<number, TeachingSkinPresetDefinition>()
    if (versions.has(definition.version)) throw new Error(`Teaching Skin Preset "${definition.id}" v${definition.version} is already registered.`)
    versions.set(definition.version, definition)
    this.definitions.set(definition.id, versions)
  }

  get(id: string, version: number): TeachingSkinPresetDefinition | undefined {
    return this.definitions.get(id)?.get(version)
  }

  list(): TeachingSkinPresetDefinition[] {
    return [...this.definitions.values()].flatMap((versions) => [...versions.values()])
      .sort((left, right) => left.id.localeCompare(right.id) || left.version - right.version)
  }
}

export type TeachingSkinPresetIssueCode = 'preset-missing' | 'preset-version-missing' | 'preset-invalid' | 'preset-dependency-missing'
export interface TeachingSkinPresetIssue { code: TeachingSkinPresetIssueCode; presetId: string; version: number; skinId?: string; variantId?: string }
export type TeachingSkinPresetResolution =
  | { status: 'none'; bindings: Readonly<Record<string, TeachingSkinVariantId>>; issues: readonly [] }
  | { status: 'resolved'; preset: TeachingSkinPresetDefinition; bindings: Readonly<Record<string, TeachingSkinVariantId>>; issues: readonly [] }
  | { status: 'unavailable'; bindings: Readonly<Record<string, TeachingSkinVariantId>>; issues: readonly TeachingSkinPresetIssue[] }

const EMPTY_BINDINGS: Readonly<Record<string, TeachingSkinVariantId>> = Object.freeze({})

/** Exact-version, fail-closed resolver. It never substitutes another version or partially applies bindings. */
export function resolveTeachingSkinPreset(
  registry: TeachingSkinPresetRegistry,
  ref: TeachingSkinPresetRef | undefined,
  skinRegistry: TeachingSkinRegistry,
): TeachingSkinPresetResolution {
  if (!ref) return { status: 'none', bindings: EMPTY_BINDINGS, issues: Object.freeze([]) }
  const versions = registry.list().filter((definition) => definition.id === ref.id)
  const definition = registry.get(ref.id, ref.version)
  if (!definition) {
    return { status: 'unavailable', bindings: EMPTY_BINDINGS, issues: Object.freeze([{ code: versions.length ? 'preset-version-missing' : 'preset-missing', presetId: ref.id, version: ref.version }]) }
  }
  if (!isTeachingSkinPresetDefinition(definition)) {
    return { status: 'unavailable', bindings: EMPTY_BINDINGS, issues: Object.freeze([{ code: 'preset-invalid', presetId: ref.id, version: ref.version }]) }
  }
  // The registry intentionally keeps a live source object for HMR/test mutation,
  // so a keyed entry must still prove that its current identity matches the pin.
  if (definition.id !== ref.id || definition.version !== ref.version) {
    return { status: 'unavailable', bindings: EMPTY_BINDINGS, issues: Object.freeze([{ code: 'preset-invalid', presetId: ref.id, version: ref.version }]) }
  }
  for (const [skinId, variantId] of Object.entries(definition.bindings)) {
    const skin = skinRegistry.get(skinId)
    if (!skin || !isTeachingSkinDefinition(skin) || !skin.design?.variants?.some((candidate) => candidate.id === variantId)) {
      return { status: 'unavailable', bindings: EMPTY_BINDINGS, issues: Object.freeze([{ code: 'preset-dependency-missing', presetId: ref.id, version: ref.version, skinId, variantId }]) }
    }
  }
  return { status: 'resolved', preset: definition, bindings: Object.freeze({ ...definition.bindings }), issues: Object.freeze([]) }
}
