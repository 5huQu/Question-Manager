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

Optional `design` metadata belongs directly in the static `skin.ts` definition object. It may contribute typed Tokens, Skin-local Slots, and Skin-local Variants, but it must not be extracted to local TS/JS helpers. Run `npm run skin:check` to validate it. Core runtime resolves trusted metadata into Skin-root-scoped CSS variables. Normal authors may consume only variables corresponding to Slots declared by that same Skin, for example `var(--td-skin-your-skin-slot-name)`. Do not invent undeclared `--td-skin-*` variables or use values from document JSON. See `docs/teaching-document/skins/design-metadata.md` and `docs/teaching-document/skins/design-runtime.md`.

Variant IDs are published Skin-local semantic data: saved documents may persist `{ skin: { id, variant } }`. Do not rename a published Variant ID or materially change its visual meaning casually; use a new Variant ID or a reviewed migration. Removing a Variant must remain safe because saved documents preserve it and render Base with a runtime unavailable state. Never persist Token values, CSS values, selectors, classes, or design metadata in `TeachingSkinRef`; only the stable Variant ID belongs there.

Preset source lives in `presets/**/preset.ts` and is checked by `npm run skin:check`. A published Preset `(id, version)` is compatibility API: do not materially change its Skin → Variant bindings in place. Publish a new version and retain old versions for pinned documents. A Preset definition never itself persists Tokens/CSS or materializes a Variant. The Document Style workspace may perform an explicit, user-authorized global Skin assignment transaction using the Preset's source-defined Heading and Box Skins.

## User-facing Preset and Variant UI

The Teaching Document 「文档样式」workspace is a consumer of trusted source registries, not an arbitrary authoring surface. Selecting a Preset persists its exact `{ id, version }` ref and applies its trusted Heading/Box Skin identities through the user's explicit mode: preserve existing local Skin/Variant refs, or replace compatible refs and clear their Variants. 「默认」removes the Preset and does not write `design: {}` or a fake base Preset. A block-local Variant override persists only its local `variant` ID; 「跟随整体」removes that key. Never invent `base`, `default`, `inherit`, an empty string, or `null` sentinels.

Unknown Preset, Skin, and Variant refs must remain visible and preserved until the user explicitly chooses a replacement. UI must consume the shared resolver for effective source semantics. It must never persist Tokens, CSS, classes, bindings, or HTML into a document. Global Skin assignment must be an explicit user action, must write only compatible stable Skin refs, and must never silently replace an existing local Skin or Variant.

Any Token-driven change to geometry (border width, spacing, radius, typography, display or sizing) must be checked at an A4 boundary and in print/pagination. The runtime invalidates geometry conservatively, but authors remain responsible for confirming a Skin is print-safe.

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
