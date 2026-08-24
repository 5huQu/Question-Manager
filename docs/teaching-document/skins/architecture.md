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

- `frontend/src/utils/teachingDocument/skins/types.ts`: definitions, helpers, JSON-safe ref parser.
- `frontend/src/utils/teachingDocument/skins/registry.ts`: registry class.
- `frontend/src/utils/teachingDocument/skins/registryInstance.ts`: discovery and application registry.
- `frontend/src/utils/teachingDocument/skins/resolver.ts`: compatibility and fallback decisions.

Normal skin work should not modify these modules or any pagination, ProseMirror, server, database, or print module.
