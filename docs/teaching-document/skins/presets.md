# Teaching Skin Presets

A Teaching Skin Preset is a source-defined, versioned, document-level mapping of exact Skin IDs to Skin-local Variant IDs. It is dynamic composition, not an apply-template transaction.

```ts
defineTeachingSkinPreset({
  id: 'builtin.preset.warm',
  version: 2,
  label: 'Warm',
  bindings: {
    'builtin.heading.left-accent': 'amber',
    'builtin.box.left-accent': 'green',
  },
  recommendedSkins: {
    heading: 'builtin.heading.left-accent',
    box: 'builtin.box.left-accent',
  },
})
```

Preset source is eagerly discovered from `skins/presets/**/preset.ts` and checked by `npm run skin:check`. A definition may contain only `apiVersion`, `id`, `version`, `label`, optional `description`, a non-empty `bindings` object, and optional `recommendedSkins`. It cannot contain Tokens, CSS, classes, DOM, layout settings, or code.

Documents persist only a pinned reference:

```json
{ "design": { "preset": { "id": "builtin.preset.warm", "version": 1 } } }
```

The version is required. Resolution is exact by `(id, version)`—there is no latest-version fallback. Unknown, well-formed references remain saveable and round-trip unchanged; unavailable Presets contribute no bindings. Published Preset versions are compatibility API: changing a material binding requires a new version, while old source versions should remain available. For example, Warm v1 retains only its original bindings; Warm v2 adds `recommendedSkins`, because this is a material authoring behavior change.

For a block which already has a compatible Skin, effective Variant precedence is: ephemeral preview override, explicit persisted `skin.variant`, resolved Preset binding, then Base. An explicit unknown Variant still wins over a Preset and safely renders Base if unavailable. A Preset never assigns a Skin during rendering, writes a Variant into a block, changes `BoxAppearance`, or affects unskinned blocks.

## Recommended Skin setup (Phase 2B-5)

`recommendedSkins` is optional, source-only metadata for the explicit 「应用推荐样式」authoring action. It may name only a `heading` and/or `box` Skin ID. Each named Skin must exist, have the matching target, and also occur in this Preset’s `bindings`; `npm run skin:check` enforces all three rules.

Selecting a Preset never triggers this setup. The teacher must explicitly choose which of 「章节标题」and「知识卡」to apply. The transaction only fills compatible blocks whose `skin` is absent and writes exactly:

```ts
skin: { id: 'builtin.box.left-accent', version: 1 }
```

It never writes a Variant ID, so Warm’s `green` and `amber` remain dynamic Preset contributions. Existing, explicit, missing, incompatible, and unknown Skin refs remain untouched. `recommendedSkins` is not persisted in TeachingDocument JSON and does not participate in rendering. Changing a published Preset’s bindings or `recommendedSkins` is a material compatibility change and requires a new Preset version.

## User-facing document style workspace (Phase 2B-4)

Teaching Documents now expose a dedicated 「文档样式」page. It lists registry definitions as selectable cards, including each exact registered version separately. 「默认」means `document.design?.preset === undefined`; choosing it removes the entire empty `design` field rather than persisting a synthetic Preset.

The page renders the real document through the production continuous renderer and A4 pagination path. It summarizes source Preset mappings, the document’s existing Skins, and explicit block-level overrides. When a resolved Preset declares `recommendedSkins`, the page also offers the separate explicit Recommended Skin setup transaction; it never materializes Preset bindings into blocks. A missing current Preset remains visible as unavailable and round-trips unchanged until the user explicitly chooses Default or another exact Preset.

The Heading and Box inspector exposes a Skin-local Variant selector. 「跟随整体」removes `skin.variant`; it never writes `base`, `default`, `inherit`, an empty string, or `null`. The effective source remains explicit block Variant → Preset → Base. Unknown persisted Variant IDs remain visible and safe-fallback until the user explicitly restores following or selects a valid Variant.

Still not implemented: Theme, Token override/editor, explicit persisted Base override, Preset migration, automatic Skin assignment, and Freeze/Detach Preset.
