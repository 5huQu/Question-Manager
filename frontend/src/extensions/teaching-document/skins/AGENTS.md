# Teaching Document Skin Extensions

This directory is the source-level discovery root for Teaching Document skins.

## Reading order

- `docs/teaching-document/skins/README.md`
- `docs/teaching-document/skins/create-heading-skin.md` or `docs/teaching-document/skins/create-box-skin.md`
- `docs/teaching-document/skins/layout-and-print-contract.md`
- `docs/teaching-document/skins/api-reference.md`

## Allowed scope

A normal custom skin task may modify only `frontend/src/extensions/teaching-document/skins/custom/**`: add a directory containing `skin.ts`, optional `styles.css`, and local bundlable assets. `builtin/**` is reserved for official skins and may be changed only when the user explicitly asks to modify an official skin.

A `skin.ts` file must default-export `defineHeadingSkin(...)` or `defineBoxSkin(...)` from the public, side-effect-free authoring API:

```ts
import { defineHeadingSkin } from '@/utils/teachingDocument/skins/authoring'
```

Its value imports may only be the public authoring API and a sibling CSS file such as `./styles.css`. Declarative Skins must not add extra local executable TS/JS/TSX/JSX modules or side-effect helpers. Type-only `@/` imports remain within the existing safe type boundary. Do not modify the core registry, pagination, ProseMirror core, server routes, database code, or the print pipeline for a normal skin request. Do not add executable runtime renderers, user-supplied JavaScript, or CSS/HTML to TeachingDocument JSON.

Optional `design` metadata belongs directly in the static `skin.ts` definition object. It may contribute typed Tokens, Skin-local Slots, and Skin-local Variants, but it must not be extracted to local TS/JS helpers. Run `npm run skin:check` to validate it. In Phase 2B-1B a pure runtime may resolve this trusted metadata into a scoped CSS-variable map; do not add inline styles, renderer changes, persistence, or UI expecting a visible result until Phase 2B-1C. See `docs/teaching-document/skins/design-metadata.md`.

## Completion checklist

- Use a namespaced, stable ID.
- Use the public authoring API.
- Do not modify the core registry, pagination, ProseMirror core, server, or database.
- Check the editor and an A4 page boundary.
- Run at least `npm run typecheck:frontend`, `npm run test:frontend`, and `npm run build:frontend`.

If the API cannot express the requested visual safely, report the contract limitation rather than extending core infrastructure.

## Tooling workflow

Before editing, generate the skin with `npm run skin:new -- ...`. During editing, modify only `custom/<generated-skin>/**`; do not hand-edit a registry, renderer, pagination module, or document schema.

Before finishing, run:

```sh
npm run skin:check -- --path frontend/src/extensions/teaching-document/skins/custom/<generated-skin>
npm run typecheck:frontend
npm run test:frontend
npm run build:frontend
```

Open `/teaching-documents/demo/skins` in development and check the selected skin's screen preview, A4 preview, and page-boundary sample. If `skin:check` reports an ERROR, do not claim the skin task is complete.
