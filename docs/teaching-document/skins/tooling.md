# Teaching Skin Tooling

Phase 2A adds local developer tooling around the declarative Phase 1 Skin API. It does not add a Theme, settings schema, renderer API, backend endpoint, or database storage.

## Scaffold a Skin

`skin:new` is non-interactive and writes only one new directory below `custom/`:

```sh
npm run skin:new -- --target heading --id studio.heading.lesson-title --label "章节标题" --levels 1,2 --preset left-accent
npm run skin:new -- --target box --id studio.box.notebook --label "笔记卡片" --templates concept,summary --preset header-band
```

Heading presets: `minimal`, `left-accent`, `pill`. Box presets: `minimal`, `left-accent`, `header-band`.

The generated directory contains `skin.ts`, `styles.css`, `skin.test.ts`, and `README.md`. The command rejects invalid IDs, invalid target options, an existing output directory, duplicate IDs, and duplicate class names. It never overwrites files. Add `--dry-run` to preview without writing and `--json` for machine-readable output.

## Check a Skin

```sh
npm run skin:check
npm run skin:check -- --path frontend/src/extensions/teaching-document/skins/custom/studio-heading-lesson-title
npm run skin:check -- --json
```

The checker is read-only. It statically validates the default definition, stable ID, class name, uniqueness, target compatibility metadata, `printSafe: true`, and the public authoring import. It parses CSS with PostCSS to require skin-class scoping and to reject unsafe layout rules such as fixed/sticky positioning, scrolling overflow, viewport units, external URLs, animation, and pagination properties. Warnings do not fail the command but require manual screen/A4 review.

## Skin Lab

In a development build, open `/teaching-documents/demo/skins`. It reads `teachingSkinRegistry` directly, so it has no second Skin list. The selected Skin is rendered through the production `TeachingDocumentRenderer` and the existing `A4PaginationPreview`; it does not save a document or call an API.

## Contract Tests

Generated `skin.test.ts` imports the test-only `describeTeachingSkinContract` helper. It checks runtime definition validity, registration, compatible resolution, incompatible-target fallback, and duplicate registration behavior without changing application state.
