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
  settings?: Record<string, JsonValue>
}
```

Only `id`, `version`, and `settings` are allowed at the top level. `id` must be a stable namespaced ID such as `studio.heading.lesson-title`. `version`, when present, is a positive integer. `settings` is persisted but Phase 1 has no dynamic settings UI. Settings must be JSON-safe and may not use reserved executable/presentation keys including `css`, `html`, `className`, `style`, `script`, or `component`.

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

## Optional `design` metadata (Phase 2B-1A / 2B-1B)

A Skin may add optional source metadata: `design: { tokens?, slots, variants? }`. It is a recursively static object literal checked by `npm run skin:check`. The pure runtime can resolve Base Slot defaults and an explicit Variant overlay into a trusted CSS-variable map, but it has no renderer, persistence, or UI integration in this phase. See [design-metadata.md](design-metadata.md) for the four supported typed Token kinds, Slot/Variant rules, and examples.

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
