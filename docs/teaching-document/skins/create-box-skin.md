# Create a Box Skin

Create a source module under the discovery tree:

```text
frontend/src/extensions/teaching-document/skins/custom/notebook/
  skin.ts
  styles.css
```

`skin.ts`:

```ts
import './styles.css'
import { defineBoxSkin } from '@/utils/teachingDocument/skins/authoring'

export default defineBoxSkin({
  id: 'studio.box.notebook',
  label: 'Notebook',
  version: 1,
  printSafe: true,
  className: 'td-skin-box-notebook',
  supportedTemplates: ['concept', 'summary'],
})
```

`styles.css`:

```css
.td-skin-box-notebook {
  border: 1px solid #94a3b8;
  border-left: 4px solid #334155;
  border-radius: 4px;
  background: #fff;
}

.td-skin-box-notebook .td-box-header { background: #f8fafc; }
.td-skin-box-notebook .td-box-body { background: #fff; }
```

The selector only lists Box skins compatible with the selected box template. A skin class is applied to the existing `.td-box`; `.td-box-header` and `.td-box-body` are the stable visual descendants available to CSS.

Do not redefine the Box block, its child flow, template ID, continuation markup, or pagination data attributes. Existing `appearance` values are still applied as per-card overrides. Avoid layout features that depend on the viewport or interaction to convey required information.
