import { defineTeachingSkinPreset } from '@/utils/teachingDocument/skins/authoring'

export default defineTeachingSkinPreset({
  id: 'builtin.preset.diagnostic-focus',
  version: 1,
  label: 'Diagnostic Focus',
  description: '错题避坑专题：序号徽章标题配避坑警示框。',
  bindings: {
    'builtin.heading.badge': 'red',
    'builtin.box.trap-alert': 'red',
  },
})
