# Teaching Skin Design Rendering Integration

Phase 2B-1C connects the 2B-1B resolver to the shared Teaching Document renderer through a thin adapter. The adapter consumes only resolver output and attaches a trusted CSS-variable map to the matching Heading or Box Skin root. It never attaches variables globally or copies Token/Slot/Variant resolution into React components.

Production rendering requests the optional persisted `TeachingSkinRef.variant`; when absent it uses Base. Skin Lab can temporarily override that request without serialization or an API write: an absent override uses the persisted Variant, an ID overrides it, and `null` explicitly previews Base. Legacy Skins without `design` keep their Phase 1 appearance and receive no additional style. If a requested Variant is unavailable, rendering falls back to the trusted Base map with a structured `variant-missing` issue, never mutating the persisted ref. If Design resolution is otherwise unavailable, rendering falls back to Phase 1 class CSS with no partial map and no document-facing error; Skin Lab may show structured issues.

Continuous editor preview, A4 measurement, paginated pages, and print reuse the same renderer contract. Layout signatures include deterministic Skin ID/version, requested Variant ID, resolved Variant ID, and sorted Slot/Token binding IDs (not CSS text), and are conservatively treated as geometry-affecting. This distinguishes Base from a persisted unavailable Variant even when both render the same Base map.

No Variant selector is introduced here. Theme/profile systems, token marketplace, and broader rendering architecture remain out of scope.

Phase 2B-3 adds an optional pinned document Preset. It is resolved once per document and provides only exact Skin → Variant requests; the shared adapter keeps preview override, explicit Variant, Preset, and Base precedence identical in continuous rendering, editor, A4, and print. An unavailable Preset emits no partial binding and remains preserved in document JSON.

Follow-up: static checking that every `var(--td-skin-...)` CSS reference maps to a declared Slot is intentionally deferred. Runtime remains fail-closed for emitted maps, and author guidance restricts CSS consumption to declared Slots.
