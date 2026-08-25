# Teaching Skin Design Rendering Integration

Phase 2B-1C connects the 2B-1B resolver to the shared Teaching Document renderer through a thin adapter. The adapter consumes only resolver output and attaches a trusted CSS-variable map to the matching Heading or Box Skin root. It never attaches variables globally or copies Token/Slot/Variant resolution into React components.

Production rendering always uses Base: `TeachingSkinRef` remains unchanged and contains no Variant. Skin Lab can choose a Variant only as ephemeral component state; it is neither serialized nor sent to an API. Legacy Skins without `design` keep their Phase 1 appearance and receive no additional style. If Design resolution is unavailable, rendering falls back to Phase 1 class CSS with no partial map and no document-facing error; Skin Lab may show structured issues.

Continuous editor preview, A4 measurement, paginated pages, and print reuse the same renderer contract. Resolved Skin design state is included in layout signatures as deterministic Skin ID/version, Variant ID, and sorted Slot/Token binding IDs (not CSS text), and is conservatively treated as geometry-affecting. A Base/Variant map change therefore invalidates cached measurements without altering pagination algorithms, document persistence, or A4 measurement semantics.

Phase 2B-2 remains out of scope: no document-selected Variants, theme/profile system, token marketplace, backend persistence, or broader rendering architecture is introduced here.

Follow-up: static checking that every `var(--td-skin-...)` CSS reference maps to a declared Slot is intentionally deferred. Runtime remains fail-closed for emitted maps, and author guidance restricts CSS consumption to declared Slots.
