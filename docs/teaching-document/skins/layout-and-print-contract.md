# Layout and Print Contract

Skins must work in the editable canvas, A4 preview, and print without changing the document engine's assumptions.

Allowed CSS is limited to a visual treatment scoped to the skin class and stable Box descendants. Prefer borders, background colors, typography adjustments, padding, and ordinary flow layout.

Do not:

- modify or rely on core `data-block-id`, `data-block-type`, pagination anchors, or editable content DOM;
- use `position: fixed`, portals, JavaScript-driven measurements, or required animation;
- make content appear only on hover, focus, or a screen-size media query;
- hide/reorder semantic content, replace a block's renderer, or add an independently scrolling region;
- edit pagination/measurement/print modules to compensate for one skin;
- persist CSS, HTML, class names, React, or executable values in TeachingDocument JSON.

Skin CSS can affect normal document-flow dimensions, so test a skin near a page boundary in editor and A4 preview. It should not require a pagination implementation change. If a requested visual cannot meet this contract, report the limitation rather than extending core systems.
