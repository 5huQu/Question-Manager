# Skin API Reference

Import the side-effect-free authoring API in ordinary extension code. It does not load discovery, the registry, or the resolver.

```ts
import { defineHeadingSkin, defineBoxSkin } from '@/utils/teachingDocument/skins/authoring'
```

## `TeachingSkinRef`

```ts
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

interface TeachingSkinRef {
  id: string
  version?: number
  variant?: string
  settings?: Record<string, JsonValue>
}
```

Only `id`, `version`, `variant`, and `settings` are allowed at the top level. `id` must be a stable namespaced ID such as `studio.heading.lesson-title`. `version`, when present, is a positive integer. `variant`, when present, is a stable Skin-local ID using lower camel case such as `green`, `greenCompact`, or `compact2`; it is never a CSS value, class, selector, or Token binding. Its absence means the Skin's Base appearance—do not eagerly write `base`, `null`, or an empty string. `settings` is persisted but Phase 1 has no dynamic settings UI. Settings must be JSON-safe and may not use reserved executable/presentation keys including `css`, `html`, `className`, `style`, `script`, or `component`.

Persistence validation is structural only and never checks whether the current registry contains the Skin or Variant. An unknown well-formed Variant is preserved on load/save; the renderer safely uses Base and reports `variant-missing` at runtime. A missing Skin preserves its full ref, including `variant`, and uses the existing visual fallback. The editor’s local Variant selector offers only source-defined Variants plus 「跟随整体」; following removes the optional `variant` key and never stores `base`, `default`, `inherit`, `null`, or an empty string.

## `TeachingDocument.design.preset`

An optional document design object may contain only `preset: { id, version }`. Both fields are required and `version` is a positive integer. It is a pinned source Preset reference, not CSS, Token, or a Variant snapshot. Registry availability is not checked at persistence boundaries: an unknown well-formed reference round-trips unchanged and contributes no runtime binding until its exact version is available. The 「文档样式」page displays it as unavailable but does not mutate it on render; selecting Default or a registry card is the only way the UI changes this ref. See [presets.md](presets.md).

## Shared definition fields

```ts
{
  apiVersion: 1,
  id: 'studio.heading.lesson-title',
  target: 'heading',
  label: 'Lesson title',
  description: 'Optional explanation',
  version: 1,
  author: 'Optional author',
  tags: ['lesson'],
  printSafe: true,
  className: 'td-skin-heading-lesson-title',
}
```

`apiVersion`, `target`, and the definition type are set by `defineHeadingSkin` or `defineBoxSkin`; do not duplicate them manually. `printSafe` is required and must be `true` in Phase 1: every registered skin must work in editor, A4 preview, and print. `className` must be a stable, extension-owned CSS class. The core applies it only after a successful resolve.

## Optional `design` metadata (Phase 2B-1A / 2B-2)

A Skin may add optional source metadata: `design: { tokens?, slots, variants? }`. It is a recursively static object literal checked by `npm run skin:check`. The pure runtime resolves Base Slot defaults and an explicit Variant overlay into a trusted CSS-variable map named from stable Skin ID + Slot ID; a legacy Skin without `design` resolves normally as `no-design`. A persisted `TeachingSkinRef.variant` now selects that Variant in production rendering, while Skin Lab overrides remain ephemeral. See [design-metadata.md](design-metadata.md) for the four supported typed Token kinds, Slot/Variant rules, and examples.

## Heading definition

```ts
defineHeadingSkin({
  id: 'studio.heading.lesson-title',
  label: 'Lesson title',
  version: 1,
  printSafe: true,
  className: 'td-skin-heading-lesson-title',
  supportedLevels: [1, 2],
})
```

`supportedLevels` is optional. Omit it to support levels 1 through 4.

Heading content and numbering are core-owned. The stable root contains `.td-heading-content`, with an optional `.td-heading-number` followed by editable `.td-heading-text`. Skin CSS must not select or replace these protected children. Use the Skin root and its pseudo-elements only for decoration; never synthesize semantic numbering through CSS `content`.

## Box definition

```ts
defineBoxSkin({
  id: 'studio.box.notebook',
  label: 'Notebook',
  version: 1,
  printSafe: true,
  className: 'td-skin-box-notebook',
  supportedTemplates: ['concept', 'summary'],
})
```

`supportedTemplates` is optional. Omit it to support every existing box template.

## Built-in examples

- `builtin.heading.pill`
- `builtin.heading.left-accent`
- `builtin.box.left-accent`
- `builtin.box.header-band`
