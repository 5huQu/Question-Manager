# Teaching Document Skins

Teaching Document Skins are source-level, declarative visual extensions for existing Heading and Box blocks. Phase 1 supports only these two targets.

A skin is not a block and is not a document theme:

- A **Block** holds document content and structure, such as a Heading or Box.
- A **Skin** adds a named visual treatment to one compatible block.
- A **Theme** would coordinate a whole document. Themes and theme packs are not implemented in Phase 1.

The document stores only a `TeachingSkinRef`:

```ts
{ id: 'builtin.heading.pill', version: 1 }
```

Skin code and CSS are bundled from source. TeachingDocument JSON never stores CSS, HTML, React components, class names, or executable code.

## Quick start

Start with the scaffold instead of hand-creating files:

```sh
npm run skin:new -- --target heading --id studio.heading.lesson-title --label "章节标题" --levels 1,2 --preset minimal
npm run skin:check
```

The scaffold writes only `frontend/src/extensions/teaching-document/skins/custom/<skin>/`. The application discovers every `**/skin.ts` below this directory during the frontend build; do not edit a core registry import list.

Use [create-heading-skin.md](create-heading-skin.md) or [create-box-skin.md](create-box-skin.md) for a complete example. The core API is documented in [api-reference.md](api-reference.md).

## Phase 1 boundaries

Implemented: source discovery, registry, resolver/fallback, Heading and Box selectors, persistent refs, and declarative CSS skins.

Not implemented: document themes, theme packs, runtime uploads, custom React renderers, settings forms, arbitrary CSS persistence, a marketplace, or plugin JavaScript. See [tooling.md](tooling.md) and [agent-playbook.md](agent-playbook.md) for the Phase 2A authoring workflow.
