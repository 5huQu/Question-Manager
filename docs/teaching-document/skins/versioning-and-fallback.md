# Versioning and Fallback

## Stable IDs

A skin ID is a long-lived document identifier. Use a namespaced, lowercase ID such as `studio.box.notebook`; never reuse an existing ID for a different visual contract. Increment `version` when a compatible skin definition evolves, but do not rely on the runtime to migrate settings in Phase 1.

## Resolution

For a Heading reference, the resolver checks that the ID is registered, targets Heading, and supports the current level. For Box, it checks the ID, Box target, and current `templateId` when `supportedTemplates` is declared.

| Stored value | Result |
| --- | --- |
| No `skin` field | Existing default visual; no default is written back. |
| Registered and compatible | Skin class and `data-skin-id` are applied. |
| Missing ID | Existing default visual; original ref stays in JSON. |
| Wrong target or incompatible level/template | Existing default visual; original ref stays in JSON. |

The properties panel reports missing or incompatible current refs but does not remove them. Choosing “默认 / 跟随默认” is the explicit action that removes `skin`.

## Round trip preservation

Serialization, editor JSON, client parsing, and server validation preserve a valid unknown `TeachingSkinRef`. This is intentional: a document authored with a temporarily unavailable extension must remain editable and saveable without silently losing the reference. A valid V1 reference contains only `id`, optional `version`, and optional `settings`; invalid or extra top-level fields are rejected at the server save boundary. No registry lookup occurs there, so custom source skins do not require a backend deployment.
