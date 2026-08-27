import { defineTeachingSkinPreset } from '@/utils/teachingDocument/skins/authoring'

export default defineTeachingSkinPreset({
  id: 'builtin.preset.olympiad-violet',
  version: 1,
  label: 'Olympiad',
  description: '思维拔高培优：菱形极客标题配学术定理双线框。',
  bindings: {
    'builtin.heading.diamond-tag': 'purple',
    'builtin.box.theorem-math': 'purple',
  },
})
