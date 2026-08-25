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

There is no end-user Preset selector, Theme, Token override, migration, or Apply/Freeze Preset operation in this phase.
