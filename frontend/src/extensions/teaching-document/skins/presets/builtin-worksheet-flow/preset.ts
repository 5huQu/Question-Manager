import { defineTeachingSkinPreset } from '@/utils/teachingDocument/skins/authoring'

export default defineTeachingSkinPreset({
  id: 'builtin.preset.worksheet-flow',
  version: 1,
  label: 'Worksheet Flow',
  description: '导学案流程：序号徽章标题配虚线作答框。',
  bindings: {
    'builtin.heading.badge': 'blue',
    'builtin.box.dashed-workspace': 'neutral',
  },
})
