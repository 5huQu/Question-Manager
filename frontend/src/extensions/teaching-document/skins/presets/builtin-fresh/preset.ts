import { defineTeachingSkinPreset } from '@/utils/teachingDocument/skins/authoring'

export default defineTeachingSkinPreset({
  id: 'builtin.preset.fresh',
  version: 1,
  label: 'Fresh',
  description: '轻盈现代组合：绿色标签标题配浅蓝软填充卡片。',
  bindings: {
    'builtin.heading.pill': 'green',
    'builtin.box.soft-fill': 'blue',
  },
})
