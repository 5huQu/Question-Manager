# Teaching Skin Presets

A Teaching Skin Preset is a source-defined, versioned, document-level mapping of exact Skin IDs to Skin-local Variant IDs. It is dynamic composition, not an apply-template transaction.

```ts
defineTeachingSkinPreset({
  id: 'builtin.preset.warm',
  version: 1,
  label: 'Warm',
  bindings: {
    'builtin.heading.left-accent': 'amber',
    'builtin.box.left-accent': 'green',
  },
})
```

Preset source is eagerly discovered from `skins/presets/**/preset.ts` and checked by `npm run skin:check`. A definition may contain only `apiVersion`, `id`, `version`, `label`, optional `description`, and a non-empty `bindings` object. It cannot contain Tokens, CSS, classes, DOM, layout settings, or code.

Documents persist only a pinned reference:

```json
{ "design": { "preset": { "id": "builtin.preset.warm", "version": 1 } } }
```

The version is required. Resolution is exact by `(id, version)`—there is no latest-version fallback. Unknown, well-formed references remain saveable and round-trip unchanged; unavailable Presets contribute no bindings. Published Preset versions are compatibility API: changing a material binding requires a new version, while old source versions should remain available.

For a block which already has a compatible Skin, effective Variant precedence is: ephemeral preview override, explicit persisted `skin.variant`, resolved Preset binding, then Base. An explicit unknown Variant still wins over a Preset and safely renders Base if unavailable. A Preset never assigns a Skin, writes a Variant into a block, changes `BoxAppearance`, or affects unskinned blocks.

## User-facing document style workspace (Phase 2B-4)

Teaching Documents now expose a dedicated 「文档样式」page. It lists registry definitions as selectable cards, including each exact registered version separately. 「默认」means `document.design?.preset === undefined`; choosing it removes the entire empty `design` field rather than persisting a synthetic Preset.

The page renders the real document through the production continuous renderer and A4 pagination path. It summarizes the source Preset’s Skin → Variant mappings and lists explicit block-level overrides, but it never applies Skins or materializes Preset bindings into blocks. A missing current Preset remains visible as unavailable and round-trips unchanged until the user explicitly chooses Default or another exact Preset.

The Heading and Box inspector exposes a Skin-local Variant selector. 「跟随整体」removes `skin.variant`; it never writes `base`, `default`, `inherit`, an empty string, or `null`. The effective source remains explicit block Variant → Preset → Base. Unknown persisted Variant IDs remain visible and safe-fallback until the user explicitly restores following or selects a valid Variant.

Still not implemented: Theme, Token override/editor, explicit persisted Base override, Preset migration, and Apply/Freeze Preset.
