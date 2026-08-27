import { defineTeachingSkinPreset } from '@/utils/teachingDocument/skins/authoring'

export default defineTeachingSkinPreset({
  id: 'builtin.preset.exam-monochrome',
  version: 1,
  label: 'Exam Monochrome',
  description: '正规模拟卷：居中双翼标题配纯黑白双线框。',
  bindings: {
    'builtin.heading.winged': 'neutral',
    'builtin.box.monochrome-double': 'neutral',
  },
})
