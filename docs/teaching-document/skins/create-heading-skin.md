# Create a Heading Skin

Create a folder in the discovery tree. No core registry edits are required.

```text
frontend/src/extensions/teaching-document/skins/custom/lesson-title/
  skin.ts
  styles.css
```

`skin.ts`:

```ts
import './styles.css'
import { defineHeadingSkin } from '@/utils/teachingDocument/skins'

export default defineHeadingSkin({
  id: 'studio.heading.lesson-title',
  label: 'Lesson title',
  description: 'A compact lesson heading treatment.',
  version: 1,
  printSafe: true,
  className: 'td-skin-heading-lesson-title',
  supportedLevels: [1, 2],
  tags: ['lesson'],
})
```

`styles.css`:

```css
.td-skin-heading-lesson-title {
  border-left: 4px solid #334155;
  padding-left: 0.65em;
}
```

Restart the frontend development server if it was already running, then select the heading. The selector contains only Heading skins compatible with the selected level. The core adds both your class and `data-skin-id="studio.heading.lesson-title"` to the existing heading element.

Keep the visual static and print-safe. Do not use React, portals, fixed positioning, required hover states, or animation. Do not target or replace the editor's `data-block-id`, `data-block-type`, editable content, or selection DOM.
