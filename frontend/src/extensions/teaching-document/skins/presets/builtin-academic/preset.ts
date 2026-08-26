import { defineTeachingSkinPreset } from '@/utils/teachingDocument/skins/authoring'

export default defineTeachingSkinPreset({
  id: 'builtin.preset.academic',
  version: 1,
  label: 'Academic',
  description: '冷静学术组合：下划线规则标题配细线框卡片。',
  bindings: {
    'builtin.heading.underline': 'blue',
    'builtin.box.outline': 'neutral',
  },
})
