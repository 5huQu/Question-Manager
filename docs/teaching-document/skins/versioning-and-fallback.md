# Versioning and Fallback

## Stable IDs

A skin ID is a long-lived document identifier. Use a namespaced, lowercase ID such as `studio.box.notebook`; never reuse an existing ID for a different visual contract. Increment `version` when a compatible skin definition evolves, but do not rely on the runtime to migrate settings in Phase 1.

## Resolution

For a Heading reference, the resolver checks that the ID is registered, targets Heading, and supports the current level. For Box, it checks the ID, Box target, and current `templateId` when `supportedTemplates` is declared.

| Stored value | Result |
| --- | --- |
| No `skin` field | Existing default visual; no default is written back. |
| Registered and compatible, no `variant` | Skin class plus Base design map are applied. |
| Registered and compatible, known `variant` | Skin class plus that trusted Variant's design map are applied. |
| Registered and compatible, unavailable `variant` | Base design map is applied and a runtime `variant-missing` issue is recorded. |
| Missing ID | Existing default visual; original ref, including `variant`, stays in JSON. |
| Wrong target or incompatible level/template | Existing default visual; original ref stays in JSON. |

The properties panel reports missing or incompatible current refs but does not remove them. Choosing “默认 / 跟随默认” is the explicit action that removes `skin`.

## Round trip preservation

Serialization, editor JSON, client parsing, and server validation preserve a valid unknown `TeachingSkinRef`. This is intentional: a document authored with a temporarily unavailable extension must remain editable and saveable without silently losing the reference. A valid reference contains only `id`, optional `version`, optional Skin-local `variant`, and optional `settings`; invalid or extra top-level fields are rejected at the server save boundary. No registry lookup occurs there, so custom source skins do not require a backend deployment. Published Variant IDs are compatibility API: do not rename them or materially redefine their meaning. Mint a new ID or provide a reviewed migration for a material change; removed IDs remain saved data that falls back safely to Base.

## Preset pins

A persisted Preset is `{ id, version }`, with version required. Runtime resolves the exact pair only; a missing v1 never falls forward to v2. Missing or unknown Presets are preserved and supply zero bindings. A published `(id, version)` must not materially change its bindings—publish a new version and keep prior source versions when existing documents need them.
