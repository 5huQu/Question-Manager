import './styles.css'
import { defineBoxSkin } from '@/utils/teachingDocument/skins/authoring'

export default defineBoxSkin({
  id: 'builtin.box.monochrome-double',
  label: '纯黑白双线油印框',
  description: '双重规则黑线，无任何彩色半透明，专为单色激光与学校油印设计。',
  version: 1,
  printSafe: true,
  className: 'td-skin-box-monochrome-double',
  tags: ['builtin', 'box'],
  design: {
    tokens: [
      { id: 'builtin.box.monochrome-double.border-neutral', kind: 'color', label: '中性双线色', printSafe: true, value: { hex: '#000000' } },
      { id: 'builtin.box.monochrome-double.border-blue', kind: 'color', label: '蓝色双线色', printSafe: true, value: { hex: '#2563EB' } },
      { id: 'builtin.box.monochrome-double.border-green', kind: 'color', label: '绿色双线色', printSafe: true, value: { hex: '#047857' } },
      { id: 'builtin.box.monochrome-double.border-amber', kind: 'color', label: '琥珀双线色', printSafe: true, value: { hex: '#B45309' } },
      { id: 'builtin.box.monochrome-double.border-red', kind: 'color', label: '红色双线色', printSafe: true, value: { hex: '#B91C1C' } },
      { id: 'builtin.box.monochrome-double.border-purple', kind: 'color', label: '紫色双线色', printSafe: true, value: { hex: '#7C3AED' } },
      { id: 'builtin.box.monochrome-double.border-teal', kind: 'color', label: '青色双线色', printSafe: true, value: { hex: '#0F766E' } },

      { id: 'builtin.box.monochrome-double.frame-neutral', kind: 'border', label: '中性双边框', printSafe: true, value: { widthPx: 2, style: 'solid', colorTokenId: 'builtin.box.monochrome-double.border-neutral' } },
      { id: 'builtin.box.monochrome-double.frame-blue', kind: 'border', label: '蓝色双边框', printSafe: true, value: { widthPx: 2, style: 'solid', colorTokenId: 'builtin.box.monochrome-double.border-blue' } },
      { id: 'builtin.box.monochrome-double.frame-green', kind: 'border', label: '绿色双边框', printSafe: true, value: { widthPx: 2, style: 'solid', colorTokenId: 'builtin.box.monochrome-double.border-green' } },
      { id: 'builtin.box.monochrome-double.frame-amber', kind: 'border', label: '琥珀双边框', printSafe: true, value: { widthPx: 2, style: 'solid', colorTokenId: 'builtin.box.monochrome-double.border-amber' } },
      { id: 'builtin.box.monochrome-double.frame-red', kind: 'border', label: '红色双边框', printSafe: true, value: { widthPx: 2, style: 'solid', colorTokenId: 'builtin.box.monochrome-double.border-red' } },
      { id: 'builtin.box.monochrome-double.frame-purple', kind: 'border', label: '紫色双边框', printSafe: true, value: { widthPx: 2, style: 'solid', colorTokenId: 'builtin.box.monochrome-double.border-purple' } },
      { id: 'builtin.box.monochrome-double.frame-teal', kind: 'border', label: '青色双边框', printSafe: true, value: { widthPx: 2, style: 'solid', colorTokenId: 'builtin.box.monochrome-double.border-teal' } },
    ],
    slots: [
      {
        id: 'frameBorder',
        kind: 'border',
        defaultTokenId: 'builtin.box.monochrome-double.frame-neutral',
        allowedTokenIds: [
          'builtin.box.monochrome-double.frame-neutral',
          'builtin.box.monochrome-double.frame-blue',
          'builtin.box.monochrome-double.frame-green',
          'builtin.box.monochrome-double.frame-amber',
          'builtin.box.monochrome-double.frame-red',
          'builtin.box.monochrome-double.frame-purple',
          'builtin.box.monochrome-double.frame-teal',
        ],
      },
    ],
    variants: [
      { id: 'neutral', label: '中性', description: '切换为中性双边框。', tokenBindings: { frameBorder: 'builtin.box.monochrome-double.frame-neutral' } },
      { id: 'blue', label: '蓝色', description: '切换为蓝色双边框。', tokenBindings: { frameBorder: 'builtin.box.monochrome-double.frame-blue' } },
      { id: 'green', label: '绿色', description: '切换为绿色双边框。', tokenBindings: { frameBorder: 'builtin.box.monochrome-double.frame-green' } },
      { id: 'amber', label: '琥珀', description: '切换为琥珀双边框。', tokenBindings: { frameBorder: 'builtin.box.monochrome-double.frame-amber' } },
      { id: 'red', label: '红色', description: '切换为红色双边框。', tokenBindings: { frameBorder: 'builtin.box.monochrome-double.frame-red' } },
      { id: 'purple', label: '紫色', description: '切换为紫色双边框。', tokenBindings: { frameBorder: 'builtin.box.monochrome-double.frame-purple' } },
      { id: 'teal', label: '青色', description: '切换为青色双边框。', tokenBindings: { frameBorder: 'builtin.box.monochrome-double.frame-teal' } },
    ],
  },
})
