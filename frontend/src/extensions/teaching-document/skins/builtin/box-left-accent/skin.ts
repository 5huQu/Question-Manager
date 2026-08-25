import './styles.css'
import { defineBoxSkin } from '@/utils/teachingDocument/skins/authoring'

export default defineBoxSkin({
  id: 'builtin.box.left-accent',
  label: '左侧强调线',
  description: '使用左侧色带强调卡片内容。',
  version: 1,
  printSafe: true,
  className: 'td-skin-box-left-accent',
  tags: ['builtin', 'box'],
  design: {
    tokens: [
      { id: 'builtin.box.left-accent.border-blue', kind: 'color', label: '浅蓝边框', printSafe: true, value: { hex: '#BFDBFE' } },
      { id: 'builtin.box.left-accent.accent-blue', kind: 'color', label: '蓝色强调线', printSafe: true, value: { hex: '#2563EB' } },
      { id: 'builtin.box.left-accent.header-blue', kind: 'color', label: '浅蓝标题底色', printSafe: true, value: { hex: '#EFF6FF' } },
      { id: 'builtin.box.left-accent.body-white', kind: 'color', label: '白色正文底色', printSafe: true, value: { hex: '#FFFFFF' } },
      { id: 'builtin.box.left-accent.border-green', kind: 'color', label: '浅绿边框', printSafe: true, value: { hex: '#A7F3D0' } },
      { id: 'builtin.box.left-accent.accent-green', kind: 'color', label: '绿色强调线', printSafe: true, value: { hex: '#047857' } },
      { id: 'builtin.box.left-accent.header-green', kind: 'color', label: '浅绿标题底色', printSafe: true, value: { hex: '#ECFDF5' } },
      { id: 'builtin.box.left-accent.frame-blue', kind: 'border', label: '浅蓝边框', printSafe: true, value: { widthPx: 1, style: 'solid', colorTokenId: 'builtin.box.left-accent.border-blue' } },
      { id: 'builtin.box.left-accent.frame-green', kind: 'border', label: '浅绿边框', printSafe: true, value: { widthPx: 1, style: 'solid', colorTokenId: 'builtin.box.left-accent.border-green' } },
      { id: 'builtin.box.left-accent.accent-border-blue', kind: 'border', label: '蓝色强调线', printSafe: true, value: { widthPx: 4, style: 'solid', colorTokenId: 'builtin.box.left-accent.accent-blue' } },
      { id: 'builtin.box.left-accent.accent-border-green', kind: 'border', label: '绿色强调线', printSafe: true, value: { widthPx: 4, style: 'solid', colorTokenId: 'builtin.box.left-accent.accent-green' } },
      { id: 'builtin.box.left-accent.radius', kind: 'radius', label: '圆角', printSafe: true, value: { px: 4 } },
    ],
    slots: [
      { id: 'frameBorder', kind: 'border', defaultTokenId: 'builtin.box.left-accent.frame-blue', allowedTokenIds: ['builtin.box.left-accent.frame-blue', 'builtin.box.left-accent.frame-green'] },
      { id: 'accentBorder', kind: 'border', defaultTokenId: 'builtin.box.left-accent.accent-border-blue', allowedTokenIds: ['builtin.box.left-accent.accent-border-blue', 'builtin.box.left-accent.accent-border-green'] },
      { id: 'headerFill', kind: 'color', defaultTokenId: 'builtin.box.left-accent.header-blue', allowedTokenIds: ['builtin.box.left-accent.header-blue', 'builtin.box.left-accent.header-green'] },
      { id: 'bodyFill', kind: 'color', defaultTokenId: 'builtin.box.left-accent.body-white' },
      { id: 'radius', kind: 'radius', defaultTokenId: 'builtin.box.left-accent.radius' },
    ],
    variants: [{ id: 'green', label: '绿色', description: '将卡片切换为绿色强调色。', tokenBindings: { frameBorder: 'builtin.box.left-accent.frame-green', accentBorder: 'builtin.box.left-accent.accent-border-green', headerFill: 'builtin.box.left-accent.header-green' } }],
  },
})
