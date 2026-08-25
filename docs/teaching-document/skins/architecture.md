# Skin Architecture

## Data flow

```text
extension `skin.ts` + sibling CSS
        │
        ▼
Vite `import.meta.glob` auto discovery
        │
        ▼
TeachingSkinRegistry ──► resolver (target + level/template compatibility)
        │                              │
        │                              ▼
Inspector selector              stable class + `data-skin-id`
        │                              │
        └── TeachingSkinRef ◄── TeachingDocument JSON ◄── serialization
```

The discovery root is `frontend/src/extensions/teaching-document/skins/**/skin.ts`. Built-in and custom source skins use the same discovery path. `TeachingSkinRegistry` rejects duplicate IDs at startup so persisted identifiers stay unambiguous.

## Rendering contract

Core renderers continue to own block identity, `data-block-id`, `data-block-type`, editing content DOM, selection, and pagination anchors. A resolved skin merely contributes its declared CSS class and `data-skin-id`. Heading remains a standard editable ProseMirror node; no React NodeView is introduced for it.

For Box, the existing `templateId` remains the template semantic and `appearance` remains the constrained per-card override. A skin supplies its base visual. If a card has an explicit appearance value, that value is still applied as the stronger single-card override.

## Public core modules

- `frontend/src/utils/teachingDocument/skins/authoring.ts`: side-effect-free public definition API for skin authors.
- `frontend/src/utils/teachingDocument/skins/types.ts`: definition internals and JSON-safe ref parser.
- `frontend/src/utils/teachingDocument/skins/registry.ts`: registry class.
- `frontend/src/utils/teachingDocument/skins/registryInstance.ts`: discovery and application registry.
- `frontend/src/utils/teachingDocument/skins/resolver.ts`: compatibility and fallback decisions.
- `frontend/src/utils/teachingDocument/skins/designIndex.ts`: global Token contribution index derived from that same registry. Registry-backed snapshots are rebuilt for each resolve, avoiding stale contribution data without a second discovery path.
- `frontend/src/utils/teachingDocument/skins/designResolver.ts`: guarded pure Base/explicit-Variant resolver and trusted scoped CSS-variable map. Its variable namespace uses stable Skin ID + Slot ID, and it is not connected to renderer DOM until Phase 2B-1C.

Normal skin work should not modify these modules or any pagination, ProseMirror, server, database, or print module.

## Pinned Presets

Phase 2B-3 adds a parallel source entity, `TeachingSkinPresetRegistry`, discovered from `skins/presets/**/preset.ts`. Its exact `(id, version)` lookup produces trusted Skin ID → Variant ID bindings for a document-level `{ design: { preset } }` reference. It never assigns Skin identity or writes Variants back to blocks; the shared rendering adapter applies its bindings only after preview and explicit block Variant precedence.
