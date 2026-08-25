# Teaching Skin Design Runtime

Phase 2B-1B resolves trusted static Skin metadata from the existing `TeachingSkinRegistry`. The registry is the only discovery source: there is no Token plugin tree or second `import.meta.glob` path.

The runtime builds a live Design Index from current registry definitions. A Token ID has zero, one, or multiple contributions; only exactly one contribution is usable. Missing, ambiguous, malformed, disallowed, or kind-mismatched Tokens resolve fail-closed with structured issues and no CSS-variable map.

Resolution is pure: Base Slot defaults are applied first, then a single explicit Variant may overlay declared Slot bindings. A missing Variant falls back to Base and records `variant-missing`. Token serialization accepts only trusted canonical color, bounded pixel spacing/radius, and bounded border values. Output variable names are deterministic Skin-local names such as `--td-skin-builtin-box-left-accent-header-fill`.

The resolver does not read Teaching Document JSON, persist a Variant, touch the DOM, or modify pagination by itself.
