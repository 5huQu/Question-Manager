# Teaching Skin Design Metadata

## Purpose

Phase 2B-1A lets a source-level Heading or Box Skin describe a constrained design space using optional `design` metadata. A definition may contribute global Tokens, declare Skin-local Slots, and offer Skin-local Variants.

This metadata is inert in this phase. It is readable by TypeScript, carried by the existing auto-discovered Skin definition, and checked by `npm run skin:check`. It does not create a Token registry, resolve a Variant, emit CSS variables, change a renderer, alter pagination, write `TeachingDocument` JSON, or add UI.

Use the existing side-effect-free authoring API and keep all metadata inside the one static `skin.ts` object literal:

```ts
import './styles.css'
import { defineHeadingSkin } from '@/utils/teachingDocument/skins/authoring'
```

Do not import `./tokens.ts`, `./variants.ts`, or another executable helper. The checker never executes author source and rejects identifier indirection, function calls, spreads, computed properties, and imported metadata objects.

## Token

A Token is a global, stable, namespaced source contribution. All Tokens contributed by all auto-discovered Skins share one checker namespace, so a Token ID may be defined only once. A Token is not persisted in document JSON and cannot contain arbitrary CSS strings.

Phase 2B-1A supports exactly four kinds:

| Kind | Value contract |
| --- | --- |
| `color` | `{ hex: '#RRGGBB' }`, exactly six uppercase hexadecimal digits; no alpha, CSS variables, gradients, named colors, or CSS color functions. |
| `spacing` | `{ px: number }`, finite, non-negative, and at most `96`. |
| `radius` | `{ px: number }`, finite, non-negative, and at most `96`; do not use `999px`, `%`, `em`, or a pill shorthand. |
| `border` | `{ widthPx: number, style: 'solid' | 'dashed' | 'dotted', colorTokenId: string }`; width is finite, non-negative, and at most `12`; color must reference a known `color` Token. |

Every Token must have a stable lowercase namespaced `id`, a non-empty `label`, and `printSafe: true`. A published Token ID is a semantic identity: do not redefine it to a materially different value. Mint a new Token ID for a material visual change.

## Slot

A Slot is a stable lower-camel-case compatibility API local to one Skin, such as `accentColor`, `accentSpacing`, `cardRadius`, or `cardBorder`.

```ts
{
  id: 'accentColor',
  kind: 'color',
  defaultTokenId: 'studio.color.accent.blue-600',
  allowedTokenIds: [
    'studio.color.accent.blue-600',
    'studio.color.accent.green-600',
  ],
}
```

`defaultTokenId` must resolve to a known Token of the Slot’s kind. When `allowedTokenIds` is present, it must be non-empty and duplicate-free; every referenced Token must be known and match the Slot kind, and it must include `defaultTokenId`. When omitted, a later Variant may bind any known Token of the same kind.

## Variant

A Variant is a stable lower-camel-case identifier local to one Skin. It describes a partial set of Slot-to-Token bindings; it does not contain CSS and it does not change the Skin target, DOM, class name, print contract, or renderer.

```ts
{
  id: 'green',
  label: 'Green',
  tokenBindings: {
    accentColor: 'studio.color.accent.green-600',
  },
}
```

`tokenBindings` must be a non-empty static object. Each binding must name a declared Slot, reference a known Token of the same kind, and satisfy the Slot’s optional allow-list. A Variant may leave other Slots unbound; those future bindings inherit the Base Slot defaults. `defaultVariantId` is not supported: absent Variant remains the stable Base appearance.

## Base Appearance

Base means the existing Phase 1 Skin CSS plus its Slot `defaultTokenId` metadata. In 2B-1A the defaults are descriptive only—nothing injects them into CSS. `variant === undefined` remains Base, and no current document data gains a Variant field.

## Static Source Contract

`design` is optional. When present, it may contain only `tokens`, `slots`, and `variants`; `slots` is required. Token, Slot, and Variant objects use exact allowed keys. Unknown keys such as `css`, `styles`, `variables`, `renderer`, `settings`, `theme`, `preset`, `defaultVariantId`, or arbitrary fields are invalid.

The metadata must be a recursively static literal: strings, finite numbers, booleans, `null`, arrays, and nested object literals are allowed. Identifiers, spreads, computed keys, calls, functions, dynamic template expressions, conditionals, and imported/local metadata modules are not allowed.

## Validation Rules

`npm run skin:check` reads every discovered `skin.ts`, builds the global Token namespace, then validates Slots and Variants. This remains true with `--path`: the selected Skin may reference a Token contributed by another discovered Skin. The command reports duplicate global Token IDs, unknown references, kind mismatches, invalid allow-lists, invalid Border color references, undeclared Slot bindings, and invalid metadata shapes.

The existing Phase 2A import and CSS safety rules remain unchanged. Design metadata does not make local TS/JS helpers, arbitrary CSS, or CSS variables permissible.

## Example Heading Skin

```ts
import './styles.css'
import { defineHeadingSkin } from '@/utils/teachingDocument/skins/authoring'

export default defineHeadingSkin({
  id: 'studio.heading.accent',
  label: 'Accent heading',
  version: 1,
  printSafe: true,
  className: 'td-skin-studio-heading-accent',
  design: {
    tokens: [
      { id: 'studio.color.accent.blue-600', kind: 'color', label: 'Blue 600', printSafe: true, value: { hex: '#2563EB' } },
      { id: 'studio.color.accent.green-600', kind: 'color', label: 'Green 600', printSafe: true, value: { hex: '#16A34A' } },
      { id: 'studio.spacing.2', kind: 'spacing', label: 'Spacing 2', printSafe: true, value: { px: 8 } },
      { id: 'studio.spacing.1', kind: 'spacing', label: 'Spacing 1', printSafe: true, value: { px: 4 } },
    ],
    slots: [
      { id: 'accentColor', kind: 'color', defaultTokenId: 'studio.color.accent.blue-600', allowedTokenIds: ['studio.color.accent.blue-600', 'studio.color.accent.green-600'] },
      { id: 'accentSpacing', kind: 'spacing', defaultTokenId: 'studio.spacing.2' },
    ],
    variants: [
      { id: 'green', label: 'Green', tokenBindings: { accentColor: 'studio.color.accent.green-600' } },
      { id: 'compactIsh', label: 'Compact-ish', tokenBindings: { accentSpacing: 'studio.spacing.1' } },
    ],
  },
})
```

The sibling CSS remains ordinary Phase 1 CSS in this phase. Do **not** write `var(--td-skin-...)`: there is no CSS-variable emitter until Phase 2B-1B.

## Example Box Skin

```ts
import './styles.css'
import { defineBoxSkin } from '@/utils/teachingDocument/skins/authoring'

export default defineBoxSkin({
  id: 'studio.box.notebook',
  label: 'Notebook',
  version: 1,
  printSafe: true,
  className: 'td-skin-studio-box-notebook',
  design: {
    tokens: [
      { id: 'studio.color.border.neutral-300', kind: 'color', label: 'Neutral 300', printSafe: true, value: { hex: '#CBD5E1' } },
      { id: 'studio.radius.card.md', kind: 'radius', label: 'Card radius', printSafe: true, value: { px: 8 } },
      { id: 'studio.border.card.default', kind: 'border', label: 'Card border', printSafe: true, value: { widthPx: 1, style: 'solid', colorTokenId: 'studio.color.border.neutral-300' } },
    ],
    slots: [
      { id: 'cardRadius', kind: 'radius', defaultTokenId: 'studio.radius.card.md' },
      { id: 'cardBorder', kind: 'border', defaultTokenId: 'studio.border.card.default' },
    ],
  },
})
```

## What This Does Not Do Yet

- emit or resolve CSS variables;
- create a Token/design registry, Variant resolver, or Preset runtime;
- persist Variants, Presets, Tokens, or design data in `TeachingDocument` or `TeachingSkinRef`;
- change the editor, renderer, A4 preview, print, pagination, ProseMirror, BoxAppearance, API, database, or settings UI;
- change `skin:new` arguments or generated minimal Skin files.

Phase 2B-1B may introduce a design registry, pure resolver, and scoped CSS-variable map after this source contract is proven.
