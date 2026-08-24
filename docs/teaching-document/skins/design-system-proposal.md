# Teaching Skin Design System Proposal

> Status: architecture proposal only. This document does not change Phase 1 or Phase 2A runtime contracts, source APIs, JSON schemas, storage, or rendering.

## Goals

- Let one structural Skin express intentional visual alternatives such as blue, green, compact, or minimal without creating an ID for every color-and-size combination.
- Let a teacher select a coherent teaching-material look across several already-selected Skins.
- Keep document data semantic, portable, print-safe, and compatible with the Phase 1 resolver/fallback model.
- Make the eventual CSS-variable bridge constrained and scoped, rather than exposing arbitrary CSS properties or values.
- Preserve legacy documents: an absent Skin reference must continue to mean the existing appearance, with no eager write-back.

## Non Goals

- This proposal does not implement a Document Theme, token resolver, preset runtime, UI, settings panel, persistence migration, or renderer change.
- It does not permit CSS, HTML, class names, React, executable code, arbitrary style strings, or arbitrary CSS-property maps in `TeachingDocument` JSON.
- It does not change the Heading/Box DOM, pagination, print pipeline, ProseMirror model, database, server, or API.
- A Preset is not a mechanism for adding a Skin to an unskinned legacy block. Applying a Skin remains an explicit block-level action.

## Current Architecture

Phase 1 established a deliberately small flow:

```text
TeachingDocument block
  → TeachingSkinRef { id, version?, settings? }
  → auto-discovered TeachingSkinRegistry
  → target + level/template resolver
  → stable existing Heading / Box DOM + skin class
  → editor / A4 preview / print
```

Only `id`, `version`, and `settings` are currently valid top-level `TeachingSkinRef` keys. The server and client preserve valid unknown IDs; rendering falls back without deleting them. CSS and the definition remain trusted source files, not document data. `BoxAppearance` is still the stronger per-card visual override.

Phase 2A adds authoring scaffolding, static checking, a development-only Skin Lab, and contract tests. It intentionally does not add an application-level design system.

## Terminology

### Skin

A Skin is a stable, structural visual treatment for one existing compatible block target. For example, `studio.heading.accent` means “a heading with an accent-line treatment.” It owns stable DOM assumptions, its source CSS, compatibility metadata, and a stable ID. It is **not** a color name, a teacher brand, or a document-wide theme.

`studio.heading.accent`, not `heading-green-small`, is the correct Skin boundary.

### Variant

A Variant is a named, source-defined alternative for one Skin. Examples for `studio.heading.accent` could be `blue`, `green`, `minimal`, or `compact`. A Variant selects a constrained set of token bindings for the same structure; it must not replace the renderer, target, or semantic block content.

Variant IDs are local to a Skin. `green` for a heading and `green` for a box need not mean the same token set unless a Preset deliberately binds both.

### Token

A Token is a typed, named design value owned by trusted source configuration, such as `color.brand.green-600` or `radius.card.md`. A Skin exposes named **slots**—for example `accent`, `surface`, `radius`, or `density`—and Variants bind compatible token IDs to those slots. Tokens are values; slots are the Skin’s permitted semantic inputs.

Tokens are not a generic “CSS property bag.” Their type and allowed range are known before they reach CSS.

### Preset

A Preset is a named composition for a teaching-material style, such as `teacher.math-handout`, `teacher.olympiad`, or `teacher.review-round-one`. It coordinates Variant choices and, later, constrained token bindings for multiple already-selected Skins. It does not define DOM structure and does not replace a Skin.

| Concept | Owns | Example | Must not become |
| --- | --- | --- | --- |
| Skin | structural visual treatment | `studio.heading.accent` | `heading-green-small` |
| Variant | one Skin’s visual alternative | `green` | a document theme |
| Token | typed value | `color.brand.green-600` | arbitrary CSS |
| Preset | cross-Skin composition | `teacher.math-handout` | a renderer or block type |

## Token Model

### Supported token families

The initial vocabulary should be intentionally small and print-oriented:

- **Color**: text, accent, border, surface, muted-surface, and contrast roles.
- **Spacing**: a finite named scale for padding, gap, and accent offset; values resolve from trusted source definitions.
- **Radius**: named none/small/medium/large values.
- **Typography**: approved font family IDs, weight, size step, and line-height step. These must cooperate with the document typography system rather than introduce arbitrary fonts.
- **Border**: width/style/color token references, limited to normal-flow visual borders.
- **Shadow**: a small, optional print-reviewed elevation scale. `none` should be the safe default; shadows must never be required for meaning.
- **Density**: a semantic composite token or Variant choice that binds spacing and typography slots together. It is not a free numeric CSS multiplier.

### Explicit exclusions

Tokens must not expose position, display mode, arbitrary width/height, viewport units, transforms, animation, scrolling overflow, z-index, URLs, content/HTML, selectors, arbitrary `calc()`, or pagination controls. Those properties either affect document structure or violate the existing editor/A4/print contract.

The future checker should keep enforcing the Phase 2A CSS restrictions even when a declaration uses variables.

### Type sketch (proposal only)

```ts
// Pseudo-code only. Do not import from production modules.
type TeachingSkinTokenKind =
  | 'color'
  | 'spacing'
  | 'radius'
  | 'typography'
  | 'border'
  | 'shadow'
  | 'density'

type TeachingSkinTokenId = string
type TeachingSkinSlotId = string

interface TeachingSkinTokenDefinition {
  id: TeachingSkinTokenId               // e.g. "color.brand.green-600"
  kind: TeachingSkinTokenKind
  label: string
  value: unknown                        // source-validated, kind-specific; never document JSON
  printSafe: true
}

interface TeachingSkinTokenSlot {
  id: TeachingSkinSlotId                // e.g. "accentColor"
  kind: TeachingSkinTokenKind
  required?: boolean
  defaultTokenId: TeachingSkinTokenId
  allowedTokenIds?: readonly TeachingSkinTokenId[]
}
```

`value` is deliberately opaque in this proposal. A later implementation must define a narrow discriminated value type for each family, rather than accept a `Record<string, string>` of CSS declarations.

## Variant Model

The Skin definition would eventually declare its available slots and stable Variants. A Variant references token IDs; it does not include raw CSS values.

```ts
// Pseudo-code only.
interface TeachingSkinVariant {
  id: string                            // local to one Skin, e.g. "green"
  label: string
  description?: string
  tokenBindings: Record<TeachingSkinSlotId, TeachingSkinTokenId>
}

interface TeachingSkinDesignExtension {
  slots: readonly TeachingSkinTokenSlot[]
  variants: readonly TeachingSkinVariant[]
  defaultVariantId?: string
}

// Conceptual addition to a future Skin definition, not a Phase 1 change:
const accentHeadingDesign: TeachingSkinDesignExtension = {
  slots: [
    { id: 'accentColor', kind: 'color', defaultTokenId: 'color.accent.blue-600' },
    { id: 'accentSpacing', kind: 'spacing', defaultTokenId: 'spacing.2' },
  ],
  variants: [
    { id: 'blue', label: 'Blue', tokenBindings: { accentColor: 'color.accent.blue-600', accentSpacing: 'spacing.2' } },
    { id: 'green', label: 'Green', tokenBindings: { accentColor: 'color.brand.green-600', accentSpacing: 'spacing.2' } },
    { id: 'minimal', label: 'Minimal', tokenBindings: { accentColor: 'color.neutral.500', accentSpacing: 'spacing.1' } },
  ],
  defaultVariantId: 'blue',
}
```

A variant cannot change `target`, supported levels/templates, `className`, CSS selector boundary, `printSafe`, or the stable document DOM. If a difference needs those changes, it is a new Skin or a later renderer proposal—not a Variant.

## Preset Model

A Preset composes several Skin choices into a recognizable teacher-facing style. It may choose a Variant for a known Skin and, in a later iteration, provide a constrained token binding for a declared slot. It must never carry CSS or apply a Skin to a block that has no Skin ref.

```ts
// Pseudo-code only.
interface TeachingSkinPresetEntry {
  skinId: string
  variantId?: string
  tokenBindings?: Record<TeachingSkinSlotId, TeachingSkinTokenId>
}

interface TeachingSkinPreset {
  id: string                            // e.g. "teacher.math-handout"
  version: number
  label: string
  description?: string
  entries: readonly TeachingSkinPresetEntry[]
  printSafe: true
}

const mathHandoutPreset: TeachingSkinPreset = {
  id: 'teacher.math-handout',
  version: 1,
  label: '策老师数学讲义风格',
  printSafe: true,
  entries: [
    { skinId: 'studio.heading.accent', variantId: 'green' },
    { skinId: 'studio.box.notebook', variantId: 'minimal' },
  ],
}
```

An entry that names an unavailable Skin, Variant, or Token is ignored for rendering and reported as unavailable; the stored semantic reference remains intact. This mirrors the Phase 1 missing/incompatible Skin behavior.

## Data Contract Proposal

### Options considered

#### Option A — put `color` and `radius` in `skin.settings`

```ts
{ id: 'studio.heading.accent', settings: { color: 'green', radius: 4 } }
```

**Advantages:** minimal apparent change; an individual block can be customized quickly.

**Disadvantages:** `settings` becomes an unbounded pseudo-CSS API, options cannot be consistently typed across Skins, values are difficult to validate and version, and teacher branding becomes repeated block data. It also pressures future authors to turn every CSS property into a setting.

**Long-term effect:** Skin explosion is replaced by settings explosion. This is not recommended for the design-system path. Existing Phase 1 `settings` should remain untouched and must not become the generic token transport.

#### Option B — Skin → typed Tokens → CSS variables

```text
Skin ref + optional variant/preset reference
  → registered Skin/Variant/Preset/Token metadata
  → validated token bindings
  → scoped CSS variables
  → existing Skin CSS
```

**Advantages:** separates structure, alternatives, values, and cross-Skin composition; supports source-level validation; keeps JSON semantic; makes compatibility and print review tractable.

**Disadvantages:** requires registries, resolver policy, variable emission, compatibility metadata, and UI decisions in a future scoped implementation.

**Long-term effect:** the recommended foundation. It supports teacher branding without making a Theme runtime a prerequisite.

#### Option C — Theme-first: Theme → Skin

```text
Document Theme → Skin choices and values → CSS
```

**Advantages:** strong document-wide coherence and simple teacher-facing terminology.

**Disadvantages:** prematurely combines document typography, page/layout concerns, and block decoration; risks changing legacy appearance when a document opens; makes local Variant intent less visible; and exceeds the current Phase 1 skin boundary.

**Long-term effect:** may become a later layer after Option B has proven stable. A future Theme can select Presets, but a Theme should not replace the Skin/Variant/Token model.

### Recommended persistence shape

The recommended future direction is explicit, small semantic references—not raw token values. The exact parser/schema change is deferred.

```ts
// Future proposal only. This is not valid Phase 1 JSON yet.
interface FutureTeachingSkinRef {
  id: string
  version?: number
  variant?: string                       // stable ID local to this Skin
  settings?: Record<string, JsonValue>   // legacy Phase 1 field; not generic token input
}

interface FutureTeachingDocumentSkinDesign {
  preset?: { id: string; version?: number }
}
```

Example intent:

```json
{
  "skin": {
    "id": "studio.heading.accent",
    "version": 2,
    "variant": "green"
  },
  "documentSkinDesign": {
    "preset": { "id": "teacher.math-handout", "version": 1 }
  }
}
```

The `variant` is an explicit block override. A document Preset supplies a preferred Variant only for blocks that already have a compatible Skin ref. Resolution priority should be:

1. explicit Skin-ref Variant;
2. compatible document Preset entry;
3. Skin definition default Variant;
4. existing Phase 1 Skin CSS/default appearance.

No stored Preset should implicitly assign an ID to an unskinned block. This prevents a legacy document from acquiring visual changes merely because a Preset becomes available.

## CSS Variable Strategy

The future resolver would resolve only trusted token IDs from source registries. It would then attach a finite variable map to the resolved Skin root, conceptually:

```text
TeachingSkinRef + document Preset ref
  → Skin resolver + design metadata
  → { "--td-skin-accent-color": "…", "--td-skin-radius": "…" }
  → existing element carrying .td-skin-…
  → sibling Skin CSS uses var(--td-skin-…)
```

```css
/* Future Skin CSS example. The selector still starts at the exact Skin root. */
.td-skin-studio-heading-accent {
  border-left-color: var(--td-skin-accent-color);
  padding-left: var(--td-skin-accent-spacing);
}
```

Variables must be scoped to the resolved Skin root (the existing Heading or Box element), not `:root` and not a global stylesheet. This allows two different Skin instances to resolve differently without cross-document leakage. If a later Preset needs an inherited document-level value, it may use a namespaced variable on the existing document container, but each Skin must map it to a local `--td-skin-*` variable at its own root.

The runtime must construct this map from registered definitions only. It must not copy a document JSON object into `style`, `className`, a CSS string, or an arbitrary custom-property map.

## Persistence Strategy

- Persist only stable semantic IDs: Skin ID, optional Skin version, optional Variant ID, and optional Preset ID/version.
- Keep Token definitions, CSS values, CSS variable names, class names, source CSS, and migration metadata in trusted source packages or future verified workspace configuration—not in `TeachingDocument` JSON.
- Do not use `settings` for generic `color`, `radius`, or style values. A future per-Skin semantic setting requires its own declared schema and a separately reviewed proposal.
- Preserve unknown-but-well-formed Skin, Variant, and Preset references on save. Rendering must safely fall back and show an unavailable state rather than deleting user intent.
- Do not eagerly persist a default Variant or Preset. Absence remains meaningful for legacy compatibility.

## Versioning Strategy

Skin IDs, Variant IDs, Token IDs, and Preset IDs should be stable, namespaced identifiers. The Skin’s `version` remains the compatibility marker for the structural definition; Presets carry their own version because they compose multiple Skins.

For a rename such as `accentColor` → `primaryAccent`:

1. Keep the old slot/token alias in trusted source metadata for the supported compatibility window.
2. Resolve the old reference through a declarative compatibility table to the new semantic slot/token where the mapping is unambiguous.
3. For a behavior-changing or ambiguous migration, mint a new Variant or new Skin ID rather than silently reinterpret a document.
4. If the owning source extension is unavailable, preserve the old ref and use the existing fallback appearance.

No arbitrary migration code should be embedded in document JSON or custom Skin modules. A later implementation should prefer data-only alias maps and explicit user-confirmed migration commands over mutation on document open.

## Migration Strategy

The proposed rollout deliberately avoids a one-time rewrite:

1. **Document the model** (this proposal) and freeze the distinction between definition metadata and document refs.
2. **Add source-level design metadata** in a later isolated change, without changing persisted document data.
3. **Introduce explicit optional references** only after client/server validation, resolver fallback behavior, and tests are designed together.
4. **Keep Phase 1 refs valid.** An existing `{ id, version?, settings? }` gets the registered Skin’s default Variant; it is not rewritten on open or save.
5. **Offer opt-in migration later.** If a user chooses a Preset or Variant, write only the minimal new semantic reference. Never infer a teacher brand from old content.
6. **Retain fallback preservation.** Missing/incompatible future IDs round-trip without data loss, just as Phase 1 missing Skin IDs do today.

## Teacher Branding

Teacher branding should exist, but in layers with different persistence responsibilities:

- **Source/package Preset library:** trusted built-in or workspace-installed presets define what `teacher.math-handout`, `teacher.olympiad`, and `teacher.review-round-one` mean.
- **User/workspace default:** an eventual authoring preference can suggest a Preset for new work. It must not alter saved documents implicitly, and it does not require an account-system design.
- **Document-level pinned Preset:** an explicit document reference makes a shared document’s intended style reproducible, while preserving a fallback when the Preset is unavailable.
- **Block-level Variant:** an author may explicitly override a document Preset for one selected Skin. This is the exception, not the mechanism for branding every block individually.

This layering lets Teacher A use a math-handout palette, Teacher B use an olympiad style, and Teacher C use a review-round-one style without inventing separate structural Skins for each color or density combination.

## Future UI Direction

No UI is proposed for this change. A later UI should keep choices legible:

- Skin selector: structural treatment only.
- Variant selector: alternatives valid for the selected Skin only.
- Document style/Preset selector: applies a composition to compatible, already-selected Skins and clearly shows affected blocks.
- Token controls: expose only declared semantic slots and named options; never an arbitrary CSS editor.
- Inspector state: distinguish missing Skin, missing Variant, missing Preset, and incompatible target without erasing stored refs.

Any apply action should preview editor, A4, and print behavior and must remain subject to the existing BoxAppearance override rule.

## Open Questions

1. Should source-level Token and Preset libraries share the existing Skin discovery tree or receive a separate, read-only discovery contract?
2. Which constrained color format and typography/font IDs can be reliably validated and printed across supported platforms?
3. Should per-document token selection be omitted permanently, or later permit only token-ID overrides declared by a Preset entry?
4. How should a Preset report partial availability when only some referenced extensions are installed?
5. Should document-level Preset selection be serialized immediately on an explicit user action, or represented first as an authoring draft until save?
6. What accessibility and grayscale-print contrast checks should be required before a Token or Preset is registered?
7. How should the existing `BoxAppearance` priority be represented in a future inspector so users understand why it wins over a Skin base visual?

## Recommended Implementation Order

1. Review and accept the semantic boundaries in this proposal.
2. Define source-only, side-effect-free Token/Variant/Preset metadata types and validator/checker rules in a separate scoped change.
3. Add registry and resolver support using data-only resolution and local CSS-variable maps, with no JSON shape change yet.
4. Add parser/server validation and compatibility tests for optional Variant/Preset references, preserving legacy and unavailable refs.
5. Add a development preview before any user-facing selector or settings UI.
6. Introduce explicit document-level Preset UI and opt-in migration only after print, A4, persistence, and fallback behavior are verified.
7. Consider a broader Theme layer only after Preset behavior proves insufficient; it should compose this model rather than replace it.
