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

It may import its sibling CSS. Do not modify the core registry, pagination, ProseMirror core, server routes, database code, or the print pipeline for a normal skin request. Do not add executable runtime renderers, user-supplied JavaScript, or CSS/HTML to TeachingDocument JSON.

## Completion checklist

- Use a namespaced, stable ID.
- Use the public authoring API.
- Do not modify the core registry, pagination, ProseMirror core, server, or database.
- Check the editor and an A4 page boundary.
- Run at least `npm run typecheck:frontend`, `npm run test:frontend`, and `npm run build:frontend`.

If the API cannot express the requested visual safely, report the contract limitation rather than extending core infrastructure.
