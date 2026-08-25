# Teaching Skin Agent Playbook

Use this workflow for Codex, Claude Code, Gemini CLI, or another Coding Agent creating one declarative Heading or Box Skin.

1. Read `frontend/src/extensions/teaching-document/skins/AGENTS.md` and the linked print contract.
2. Identify whether the request is a Heading or Box Skin.
3. Run `npm run skin:new -- ...` with a stable namespaced ID.
4. Modify only the generated `custom/<skin>/` directory.
5. Run `npm run skin:check -- --path ...` and fix every ERROR.
6. Open `/teaching-documents/demo/skins` in development.
7. Check the screen preview, A4 preview, and page-boundary sample.
8. Run the generated contract test and the relevant frontend checks.
9. Report the result and any contract limitation.

## Declarative import boundary

Keep `skin.ts` declarative. Its value imports may only be the public authoring API and a sibling CSS file such as `./styles.css`. Do not add local TS/JS/TSX/JSX helper or side-effect modules, including indirectly importing registry, resolver, renderer, NodeViews, pagination, server, or database code. Type-only `@/` imports are permitted within the existing type boundary.

## Optional design metadata

When a Skin needs to describe Tokens, Slots, or Variants, add a static `design` object literal directly to `defineHeadingSkin(...)` or `defineBoxSkin(...)`. Do not extract it to `tokens.ts` or call a helper. Run `npm run skin:check`: it validates the typed metadata and global Token namespace. This metadata is inert in Phase 2B-1A—do not add CSS variables or expect a visual effect; Phase 2B-1B is the first planned consumer. See [design-metadata.md](design-metadata.md).

## Reference-image workflow

When a user provides a title or card reference image, first decide whether it can be represented as a declarative CSS Skin. Identify the target, normal-flow layout, border, background, spacing, decoration, and typography. Scaffold the Skin and implement only CSS scoped to its generated class.

Do not modify NodeViews, `TeachingDocumentRenderer`, pagination, server code, or the database because a reference is visually complex. If the request requires new DOM structure, a React renderer, or a measurement hook, report: “Phase 1 Skin Contract 无法安全表达此视觉。” Those are later-phase capabilities, not a reason to bypass the contract.
