# Teaching Skin Design System Proposal

> Status: architecture proposal with Phase 2B-5 implemented. The Variant/Preset model remains the architectural direction; `TeachingSkinRef.variant` persistence, pinned Presets, the Document Style / local Variant UX, and explicit Recommended Skin setup are now part of the current contract.

## Goals

- Let one structural Skin express intentional visual alternatives such as blue, green, compact, or minimal without creating an ID for every color-and-size combination.
- Let a teacher select a coherent teaching-material look across several already-selected Skins, while reserving structural Skin assignment for an explicit editing action.
- Keep document data semantic, portable, print-safe, and compatible with the Phase 1 resolver/fallback model.
- Make the eventual CSS-variable bridge constrained and scoped, rather than exposing arbitrary CSS properties or values.
- Preserve legacy documents: an absent Skin reference must continue to mean the existing appearance, with no eager write-back.

## Non Goals

- This proposal does not implement a Document Theme, Token editor, explicit Base persistence, automatic Preset application, Freeze/Detach Preset operation, or a Variant/Preset migration framework. The exact-Skin pinned Preset runtime, document style/local Variant UI, and explicit Recommended Skin setup are implemented through Phase 2B-5; scoped matching and Token bindings remain future work.
- It does not permit CSS, HTML, class names, React, executable code, arbitrary style strings, or arbitrary CSS-property maps in `TeachingDocument` JSON.
- It does not change the Heading/Box DOM, pagination algorithms, print pipeline structure, ProseMirror model, or database schema.
- A Preset is not a runtime mechanism for adding a Skin to an unskinned legacy block. The optional source-only `recommendedSkins` hint is consumed solely by an explicit authoring transaction.

## Current Architecture

Phase 1 established a deliberately small flow:

```text
TeachingDocument block
  → TeachingSkinRef { id, version?, variant?, settings? }
  → auto-discovered TeachingSkinRegistry
  → target + level/template resolver
  → stable existing Heading / Box DOM + skin class
  → editor / A4 preview / print
```

Only `id`, `version`, `variant`, and `settings` are valid top-level `TeachingSkinRef` keys. `variant` is an optional stable Skin-local ID; absence means Base. The server and client preserve valid unknown Skin and Variant IDs; rendering falls back without deleting them. CSS and the definition remain trusted source files, not document data. `BoxAppearance` is still the stronger per-card visual override.

Phase 2B now adds source design metadata, a pure resolver, trusted Skin-root CSS variables, and persisted Variant IDs with safe fallback. It intentionally does not add an application-level theme or Variant-selector UX.

## Terminology

### Skin

A Skin is a stable, structural visual treatment for one existing compatible block target. For example, `studio.heading.accent` means “a heading with an accent-line treatment.” It owns stable DOM assumptions, its source CSS, compatibility metadata, and a stable ID. It is **not** a color name, a teacher brand, or a document-wide theme.

`studio.heading.accent`, not `heading-green-small`, is the correct Skin boundary.

### Variant

A Variant is a named, source-defined alternative for one Skin. Examples for `studio.heading.accent` could be `blue`, `green`, `minimal`, or `compact`. A Variant selects a constrained set of token bindings for the same structure; it must not replace the renderer, target, or semantic block content.

Variant IDs are stable **Skin-local** IDs. `green` for a heading and `green` for a box need not mean the same token set unless a Preset deliberately binds both. They are compatibility API once published and must not be renamed casually.

### Token

A Token is a typed, named design value owned by trusted source configuration, such as `studio.color.brand.green-600` or `studio.radius.card.md`. A Skin exposes named **slots**—for example `accent`, `surface`, `radius`, or `density`—and Variants bind compatible token IDs to those slots. Tokens are values; slots are the Skin’s permitted semantic inputs. Slot IDs are stable **Skin-local** IDs and are also compatibility API after publication.

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

The complete future vocabulary is intentionally small and print-oriented:

- **Color**: text, accent, border, surface, muted-surface, and contrast roles.
- **Spacing**: a finite named scale for padding, gap, and accent offset; values resolve from trusted source definitions.
- **Radius**: named none/small/medium/large values.
- **Typography**: approved font family IDs, weight, size step, and line-height step. These must cooperate with the document typography system rather than introduce arbitrary fonts.
- **Border**: width/style/color token references, limited to normal-flow visual borders.
- **Shadow**: a small, optional print-reviewed elevation scale. `none` should be the safe default; shadows must never be required for meaning.
- **Density**: a semantic composite token or Variant choice that binds spacing and typography slots together. It is not a free numeric CSS multiplier.

### First implementation subset

The Phase 2B-1 minimal subset should be **color, spacing, radius, and border**. It is enough to prove typed bindings, scoped variable emission, and page-layout invalidation without introducing unresolved ownership rules.

Defer **typography** until its precedence against the existing Document Typography System is defined. Defer **density** until its relationship to Variant semantics is narrowed. Defer **shadow** until print and grayscale policy establishes whether it is useful and how it degrades. The complete vocabulary remains the long-term design target; this is only a staged rollout boundary.

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
  id: TeachingSkinTokenId               // global stable ID, e.g. "studio.color.brand.green-600"
  kind: TeachingSkinTokenKind
  label: string
  value: unknown                        // source-validated, kind-specific; never document JSON
  printSafe: true
}

interface TeachingSkinTokenSlot {
  id: TeachingSkinSlotId                // Skin-local stable ID, e.g. "accentColor"
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
  id: string                            // Skin-local stable ID, e.g. "green"
  label: string
  description?: string
  tokenBindings: Record<TeachingSkinSlotId, TeachingSkinTokenId>
}

interface TeachingSkinDesignExtension {
  slots: readonly TeachingSkinTokenSlot[]
  variants: readonly TeachingSkinVariant[]
}

// Conceptual addition to a future Skin definition, not a Phase 1 change:
const accentHeadingDesign: TeachingSkinDesignExtension = {
  slots: [
    { id: 'accentColor', kind: 'color', defaultTokenId: 'studio.color.accent.blue-600' },
    { id: 'accentSpacing', kind: 'spacing', defaultTokenId: 'studio.spacing.2' },
  ],
  variants: [
    { id: 'blue', label: 'Blue', tokenBindings: { accentColor: 'studio.color.accent.blue-600', accentSpacing: 'studio.spacing.2' } },
    { id: 'green', label: 'Green', tokenBindings: { accentColor: 'studio.color.brand.green-600', accentSpacing: 'studio.spacing.2' } },
    { id: 'minimal', label: 'Minimal', tokenBindings: { accentColor: 'studio.color.neutral.500', accentSpacing: 'studio.spacing.1' } },
  ],
}
```

### Base appearance, not a default Variant

`variant === undefined` must resolve to the stable Phase 1 **Base appearance**: the Skin’s source CSS and declared slot defaults, without selecting a Variant. There is deliberately no `defaultVariantId` runtime concept. Base CSS and Base slot defaults remain part of the Skin’s compatibility contract; materially changing them requires the same version/new-ID judgment as changing the existing Phase 1 Skin appearance.

This is safer than allowing a Skin author to change `defaultVariantId`: a legacy ref such as `{ id: "studio.heading.accent" }` would otherwise silently change when source defaults change. A Variant is an explicit overlay on Base, selected by a block ref or a compatible Preset. Changing an existing Variant’s meaning is a compatibility change; create a new Variant ID or Skin version/ID when the visual contract is materially different.

A Variant cannot change `target`, supported levels/templates, `className`, CSS selector boundary, `printSafe`, or the stable document DOM. If a difference needs those changes, it is a new Skin or a later renderer proposal—not a Variant.

## Preset Model

A Preset composes several Skin choices into a recognizable teacher-facing style. It may choose a Variant for a known Skin and, in a later iteration, provide a constrained token binding for a declared slot. It must never carry CSS or apply a Skin to a block that has no Skin ref.

Preset entries may use only controlled block semantics as their matching scope. They may not use CSS selectors, arbitrary predicates, or runtime functions.

```ts
// Pseudo-code only.
type TeachingSkinPresetScope =
  | {
      target: 'heading'
      levels: readonly (1 | 2 | 3 | 4)[]
    }
  | {
      target: 'box'
      templates: readonly string[]
    }

interface TeachingSkinPresetEntry {
  skinId: string
  scope?: TeachingSkinPresetScope
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
    { skinId: 'studio.heading.accent', scope: { target: 'heading', levels: [1] }, variantId: 'strong' },
    { skinId: 'studio.heading.accent', scope: { target: 'heading', levels: [2] }, variantId: 'minimal' },
    { skinId: 'studio.box.notebook', scope: { target: 'box', templates: ['concept'] }, variantId: 'blue' },
    { skinId: 'studio.box.notebook', scope: { target: 'box', templates: ['warning'] }, variantId: 'amber' },
  ],
}
```

### Scoped matching and validation

`scope === undefined` is the whole-Skin default match. If `scope` is present, it must select a non-empty semantic subset: Heading requires non-empty, duplicate-free `levels`; Box requires non-empty, duplicate-free `templates`. Target-only scope is not valid because it has the same match set as an unscoped entry for a known Skin.

For a block with a compatible selected Skin, resolution first considers matching semantic-subset entries, then an unscoped entry for that Skin, then the Base appearance. Among matching subset entries, a smaller matching finite `levels`/`templates` set is more specific than a larger one.

The source validator/checker must reject a Preset when two subset entries for the same Skin have equal specificity and can match the same block. For example, two heading entries scoped to `[1]` conflict at H1, while `[1, 2]` and `[2, 3]` with equal cardinality conflict at H2. This is invalid source metadata, not a runtime tie-breaker. The same rule applies to Box template scopes. An entry’s scope target must also agree with the referenced Skin target.

The compact precedence contract is therefore:

1. most-specific compatible semantic-subset Preset entry;
2. compatible unscoped Preset entry for the selected Skin;
3. Base appearance.

An entry that names an unavailable Skin, Variant, or Token is ignored for rendering and reported as unavailable; the stored semantic reference remains intact. This mirrors the Phase 1 missing/incompatible Skin behavior.

### Preset composition versus explicit structural application

There are two deliberately separate future operations:

- **Document-level pinned Preset** is runtime design composition. It supplies a Variant/token choice only after a block already has a compatible Skin ref. It never changes block Skin identity, so legacy documents do not change merely because a Preset becomes available.
- **Explicit Recommended Skin setup** is an author-invoked editing transaction. It may inspect controlled Heading level and Box template semantics, writes only compatible Skin `{ id, version }` refs to currently unskinned blocks, and is one document operation. It never writes optional Variant refs and is not an implicit resolver behavior.

Phase 2B-5 keeps this narrow: a Preset may offer only one explicit recommendation per Heading/Box target, and only when that Skin is also bound by the same exact Preset. More expressive profiles, automatic assignment, and Variant materialization remain future work. This preserves both practical “数学讲义风格” setup and the legacy fallback guarantee.

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
  variant?: string                       // stable Skin-local Variant ID
  settings?: Record<string, JsonValue>   // legacy Phase 1 field; not generic token input
}

interface FutureTeachingDocumentSkinDesign {
  preset?: { id: string; version: number }
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
2. most-specific compatible document Preset entry;
3. compatible unscoped document Preset entry;
4. Base appearance.

`variant` absence is not an instruction to resolve a source-defined default Variant. It means Base appearance. No stored Preset should implicitly assign an ID to an unskinned block. This prevents a legacy document from acquiring visual changes merely because a Preset becomes available.

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

## Layout Dependency Contract

Variants, Presets, and resolved Token bindings are rendering dependencies, not paint-only hints. Spacing, radius, border, typography, and density can change a block’s geometry; therefore future pagination/layout code must include the resolved design identity in its layout signature and invalidation decisions.

```ts
// Derived runtime state only; never persisted as a CSS value or document payload.
interface ResolvedDesignSignature {
  skinId: string
  skinVersion?: number
  explicitVariantId?: string
  presetId?: string
  presetVersion?: number
  resolvedVariantId?: string
  resolvedTokenBindings: readonly {
    slotId: TeachingSkinSlotId
    tokenId: TeachingSkinTokenId
  }[]
}
```

The initial rule should be conservative: any change in Variant, Preset, or resolved Token binding identity marks affected blocks layout-dirty and remeasures them before pagination/print output is considered current. Correct page boundaries take priority over avoiding a remeasurement.

A future optimization may let **core-owned** token metadata classify a token kind as `paint-only` or `geometry-affecting`. Skin authors must not self-report layout impact: allowing that would let an author misclassify a spacing or typography change and create stale pagination. This proposal does not modify pagination; it records the dependency that a future implementation must honor.

## Persistence Strategy

- Persist only stable semantic IDs: Skin ID, optional Skin version, optional Variant ID, and optional Preset ID/version.
- Keep Token definitions, CSS values, CSS variable names, class names, source CSS, and migration metadata in trusted source packages or future verified workspace configuration—not in `TeachingDocument` JSON.
- Do not use `settings` for generic `color`, `radius`, or style values. A future per-Skin semantic setting requires its own declared schema and a separately reviewed proposal.
- Preserve unknown-but-well-formed Skin, Variant, and Preset references on save. Rendering must safely fall back and show an unavailable state rather than deleting user intent.
- Do not eagerly persist a default Variant or Preset. Absence remains meaningful for legacy compatibility.

## Versioning Strategy

The ID rule is intentionally mixed:

- **Global stable namespaced IDs:** Skin (`studio.heading.accent`), Token (`studio.color.brand.green-600`), and Preset (`teacher.math-handout`).
- **Skin-local stable IDs:** Variant (`green`) and Slot (`accentColor`). Their full compatibility identity is the owning Skin ID plus local ID, such as `studio.heading.accent#green`.

Local IDs avoid repeating the Skin namespace in every Variant/Slot declaration, while still being published compatibility API that cannot be casually renamed. The Skin’s `version` remains the compatibility marker for the structural definition; Presets carry their own version because they compose multiple Skins.

For a rename such as `accentColor` → `primaryAccent`:

1. Keep the old slot/token alias in trusted source metadata for the supported compatibility window.
2. Resolve the old reference through a declarative compatibility table to the new semantic slot/token where the mapping is unambiguous.
3. For a behavior-changing or ambiguous migration, mint a new Variant or new Skin ID rather than silently reinterpret a document.
4. If the owning source extension is unavailable, preserve the old ref and use the existing fallback appearance.

No arbitrary migration code should be embedded in document JSON or custom Skin modules. A later implementation should prefer data-only alias maps and explicit user-confirmed migration commands over mutation on document open.

### Published design identity immutability and reproducibility

A stable ID is a published semantic identity, not a mutable label. Source evolution must not make a pinned document materially change appearance with no JSON change or availability signal.

- **Published Token ID:** a Token ID represents one stable semantic value. Its value must not be redefined to a materially different color, spacing, radius, border, or other visual result under the same ID. Mint a new Token ID for a clearly visible change; retain the old ID for the supported compatibility window or make its absence an explicit unavailable state.
- **Published Variant ID:** a Variant’s `tokenBindings` are part of its compatibility semantics. Do not silently redefine `studio.heading.accent#green` into a visibly different composition. Mint a new local Variant ID for a material change, or provide an explicit, reviewed migration strategy that preserves old intent.
- **Published Preset version:** when document persistence stores `preset.id + preset.version`, version is a resolver address, not decoration. The recommended future rule is a versioned Preset registry: it retains/discovers resolvable definitions for every supported `(id, version)` pair. If that exact version is unavailable, resolution must report it as unavailable and fall back safely; it must never silently resolve the latest version instead.
- **Base appearance:** Base CSS and Base slot defaults are part of the Skin compatibility contract. Until a future runtime genuinely resolves versioned Skin definitions, a version bump alone cannot make a material Base change reproducible. The safer direction is a new Skin ID or an explicit user-confirmed migration, while retaining the old source definition for supported documents.

This contract keeps a pinned document’s semantic intent reproducible across source evolution. Compatible refinements may remain under an existing ID only when they do not materially alter the established visual/print meaning; ambiguity is resolved in favor of a new identity or visible fallback, not a silent reinterpretation.

## Migration Strategy

The proposed rollout deliberately avoids a one-time rewrite:

1. **Document the model** (this proposal) and freeze the distinction between definition metadata and document refs.
2. **Add source-level design metadata** in a later isolated change, without changing persisted document data.
3. **Introduce explicit optional references** only after client/server validation, resolver fallback behavior, and tests are designed together.
4. **Keep Phase 1 refs valid.** An existing `{ id, version?, settings? }` uses the registered Skin’s stable Base appearance; it is not rewritten on open or save.
5. **Offer opt-in migration later.** If a user chooses a Preset or Variant, write only the minimal new semantic reference. Never infer a teacher brand from old content.
6. **Retain fallback preservation.** Missing/incompatible future IDs round-trip without data loss, just as Phase 1 missing Skin IDs do today.

## Teacher Branding

Teacher branding should exist, but in layers with different persistence responsibilities:

- **Source/package Preset library:** trusted built-in or workspace-installed presets define what `teacher.math-handout`, `teacher.olympiad`, and `teacher.review-round-one` mean as design composition for already-selected Skins.
- **User/workspace default:** an eventual authoring preference can suggest a Preset for new work. It must not alter saved documents implicitly, and it does not require an account-system design.
- **Document-level pinned Preset:** an explicit document reference makes a shared document’s intended style reproducible, while preserving a fallback when the Preset is unavailable.
- **Block-level Variant:** an author may explicitly override a document Preset for one selected Skin. This is the exception, not the mechanism for branding every block individually.
- **Explicit Recommended Skin setup:** a source-only Preset hint may fill compatible, currently unskinned Heading/Box blocks after a user action. It writes only Skin id/version refs and never records provenance or materializes a Variant.

This layering lets Teacher A use a math-handout palette, Teacher B use an olympiad style, and Teacher C use a review-round-one style without inventing separate structural Skins for each color or density combination.

## User UI (Phase 2B-5)

The Teaching Document 「文档样式」page is a full workspace, not a modal. It reads the real current `TeachingDocument`, displays exact-version registry cards, writes only `design.preset: { id, version }`, and uses the production continuous/A4 render paths for preview. The Default card removes `design.preset` and does not persist an empty `design` object. Unknown Preset references and unknown explicit Variants remain visible and unchanged until an explicit user action replaces or clears them.

The existing Heading and Box inspector includes one shared local Variant selector. It consumes the shared Variant resolver to show whether the current effective style comes from the document Preset, a block-local override, or Base. 「跟随整体」removes `skin.variant`; there is no persisted Base/default/inherit sentinel. Preset selection never assigns Skins or rewrites explicit block Variants. The Document Style page may show an explicit Recommended Skin setup action, but only after the user selects it; existing and unknown Skin refs are never overwritten.

## Future UI Direction

No UI is proposed for this change. A later UI should keep choices legible:

- Skin selector: structural treatment only.
- Variant selector: alternatives valid for the selected Skin only.
- Document style/Preset selector: applies a composition to compatible, already-selected Skins and clearly shows affected blocks.
- Recommended Skin setup action: explicitly fills compatible unskinned Heading/Box blocks from source-only `recommendedSkins`, writes only Skin id/version refs, and is one document transaction.
- Token controls: expose only declared semantic slots and named options; never an arbitrary CSS editor.
- Inspector state: distinguish missing Skin, missing Variant, missing Preset, and incompatible target without erasing stored refs.

Any apply action should preview editor, A4, and print behavior and must remain subject to the existing BoxAppearance override rule.

## Open Questions

1. Should source-level Token and Preset libraries share the existing Skin discovery tree or receive separate, read-only discovery contracts?
2. What trusted-definition packaging and review model should govern workspace-installed Token, Preset, and Authoring Profile definitions?
3. Which constrained print-safe color format can be reliably validated across supported platforms?
4. How should a Preset report partial availability when only some referenced extensions are installed?
5. Should per-document token selection remain absent, or later permit only token-ID overrides declared by a Preset entry?
6. What accessibility and grayscale-print contrast checks should be required before a Token or Preset is registered?
7. How should the existing `BoxAppearance` priority be represented in a future inspector so users understand why it wins over a Skin base visual?

## Recommended Implementation Order

1. Review and accept the semantic boundaries in this proposal.
2. **2B-1A:** add source-only Token/Slot/Variant metadata types plus validation/checker rules. Start with color, spacing, radius, and border only.
3. **2B-1B:** add a design registry, pure resolver, and scoped CSS-variable map, with no persisted JSON change. *(Complete.)*
4. **2B-1C:** extend the development Skin Lab with Variant/Token preview and verify A4/layout invalidation behavior. *(Complete.)*
5. **2B-2:** add optional Variant persistence plus server/client validation, preserving legacy and unavailable refs. *(Complete.)*
6. **2B-3:** add a Preset source registry and document-level pinned Preset persistence. *(Complete.)*
7. **2B-4:** add user-facing Preset/Variant UI. *(Complete.)*
8. **2B-5:** add source-only Preset `recommendedSkins` and explicit setup for compatible unskinned Heading/Box blocks. *(Complete.)*
9. Consider a broader Theme layer only after Preset behavior proves insufficient; it should compose this model rather than replace it.
