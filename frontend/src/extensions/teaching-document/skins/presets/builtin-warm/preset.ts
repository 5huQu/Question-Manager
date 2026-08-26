import { defineTeachingSkinPreset } from '@/utils/teachingDocument/skins/authoring'

export default defineTeachingSkinPreset({
  id: 'builtin.preset.warm',
  version: 1,
  label: 'Warm',
  description: '暖色教学文档组合。',
  bindings: {
    'builtin.heading.left-accent': 'amber',
    'builtin.box.left-accent': 'green',
  },
  recommendedSkins: {
    heading: 'builtin.heading.left-accent',
    box: 'builtin.box.left-accent',
  },
})
