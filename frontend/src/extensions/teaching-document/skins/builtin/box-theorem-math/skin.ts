import './styles.css'
import { defineBoxSkin } from '@/utils/teachingDocument/skins/authoring'

export default defineBoxSkin({
  id: 'builtin.box.theorem-math',
  label: '学术定理双线框',
  description: '左侧内凹双竖线与学术标题，专用于定理推导与核心结论。',
  version: 1,
  printSafe: true,
  className: 'td-skin-box-theorem-math',
  supportedTemplates: ['concept', 'method', 'plain', 'summary'],
  tags: ['builtin', 'box'],
  design: {
    tokens: [
      { id: 'builtin.box.theorem-math.accent-blue', kind: 'color', label: '蓝色双竖线', printSafe: true, value: { hex: '#2563EB' } },
      { id: 'builtin.box.theorem-math.accent-green', kind: 'color', label: '绿色双竖线', printSafe: true, value: { hex: '#047857' } },
      { id: 'builtin.box.theorem-math.accent-amber', kind: 'color', label: '琥珀双竖线', printSafe: true, value: { hex: '#B45309' } },
      { id: 'builtin.box.theorem-math.accent-red', kind: 'color', label: '红色双竖线', printSafe: true, value: { hex: '#B91C1C' } },
      { id: 'builtin.box.theorem-math.accent-purple', kind: 'color', label: '紫色双竖线', printSafe: true, value: { hex: '#7C3AED' } },
      { id: 'builtin.box.theorem-math.accent-teal', kind: 'color', label: '青色双竖线', printSafe: true, value: { hex: '#0F766E' } },
      { id: 'builtin.box.theorem-math.accent-neutral', kind: 'color', label: '中性双竖线', printSafe: true, value: { hex: '#1E293B' } },

      { id: 'builtin.box.theorem-math.border-blue', kind: 'color', label: '浅蓝边框', printSafe: true, value: { hex: '#BFDBFE' } },
      { id: 'builtin.box.theorem-math.border-green', kind: 'color', label: '浅绿边框', printSafe: true, value: { hex: '#A7F3D0' } },
      { id: 'builtin.box.theorem-math.border-amber', kind: 'color', label: '浅琥珀边框', printSafe: true, value: { hex: '#FDE68A' } },
      { id: 'builtin.box.theorem-math.border-red', kind: 'color', label: '浅红边框', printSafe: true, value: { hex: '#FECACA' } },
      { id: 'builtin.box.theorem-math.border-purple', kind: 'color', label: '浅紫边框', printSafe: true, value: { hex: '#DDD6FE' } },
      { id: 'builtin.box.theorem-math.border-teal', kind: 'color', label: '浅青边框', printSafe: true, value: { hex: '#99F6E4' } },
      { id: 'builtin.box.theorem-math.border-neutral', kind: 'color', label: '中性边框', printSafe: true, value: { hex: '#E2E8F0' } },

      { id: 'builtin.box.theorem-math.header-blue', kind: 'color', label: '浅蓝标题背景', printSafe: true, value: { hex: '#EFF6FF' } },
      { id: 'builtin.box.theorem-math.header-green', kind: 'color', label: '浅绿标题背景', printSafe: true, value: { hex: '#ECFDF5' } },
      { id: 'builtin.box.theorem-math.header-amber', kind: 'color', label: '浅琥珀标题背景', printSafe: true, value: { hex: '#FFFBEB' } },
      { id: 'builtin.box.theorem-math.header-red', kind: 'color', label: '浅红标题背景', printSafe: true, value: { hex: '#FEF2F2' } },
      { id: 'builtin.box.theorem-math.header-purple', kind: 'color', label: '浅紫标题背景', printSafe: true, value: { hex: '#F5F3FF' } },
      { id: 'builtin.box.theorem-math.header-teal', kind: 'color', label: '浅青标题背景', printSafe: true, value: { hex: '#F0FDFA' } },
      { id: 'builtin.box.theorem-math.header-neutral', kind: 'color', label: '中性标题背景', printSafe: true, value: { hex: '#F4F4F5' } },

      { id: 'builtin.box.theorem-math.frame-blue', kind: 'border', label: '浅蓝外框', printSafe: true, value: { widthPx: 1, style: 'solid', colorTokenId: 'builtin.box.theorem-math.border-blue' } },
      { id: 'builtin.box.theorem-math.frame-green', kind: 'border', label: '浅绿外框', printSafe: true, value: { widthPx: 1, style: 'solid', colorTokenId: 'builtin.box.theorem-math.border-green' } },
      { id: 'builtin.box.theorem-math.frame-amber', kind: 'border', label: '浅琥珀外框', printSafe: true, value: { widthPx: 1, style: 'solid', colorTokenId: 'builtin.box.theorem-math.border-amber' } },
      { id: 'builtin.box.theorem-math.frame-red', kind: 'border', label: '浅红外框', printSafe: true, value: { widthPx: 1, style: 'solid', colorTokenId: 'builtin.box.theorem-math.border-red' } },
      { id: 'builtin.box.theorem-math.frame-purple', kind: 'border', label: '浅紫外框', printSafe: true, value: { widthPx: 1, style: 'solid', colorTokenId: 'builtin.box.theorem-math.border-purple' } },
      { id: 'builtin.box.theorem-math.frame-teal', kind: 'border', label: '浅青外框', printSafe: true, value: { widthPx: 1, style: 'solid', colorTokenId: 'builtin.box.theorem-math.border-teal' } },
      { id: 'builtin.box.theorem-math.frame-neutral', kind: 'border', label: '中性外框', printSafe: true, value: { widthPx: 1, style: 'solid', colorTokenId: 'builtin.box.theorem-math.border-neutral' } },
    ],
    slots: [
      {
        id: 'accentColor',
        kind: 'color',
        defaultTokenId: 'builtin.box.theorem-math.accent-neutral',
        allowedTokenIds: [
          'builtin.box.theorem-math.accent-blue',
          'builtin.box.theorem-math.accent-green',
          'builtin.box.theorem-math.accent-amber',
          'builtin.box.theorem-math.accent-red',
          'builtin.box.theorem-math.accent-purple',
          'builtin.box.theorem-math.accent-teal',
          'builtin.box.theorem-math.accent-neutral',
        ],
      },
      {
        id: 'frameBorder',
        kind: 'border',
        defaultTokenId: 'builtin.box.theorem-math.frame-neutral',
        allowedTokenIds: [
          'builtin.box.theorem-math.frame-blue',
          'builtin.box.theorem-math.frame-green',
          'builtin.box.theorem-math.frame-amber',
          'builtin.box.theorem-math.frame-red',
          'builtin.box.theorem-math.frame-purple',
          'builtin.box.theorem-math.frame-teal',
          'builtin.box.theorem-math.frame-neutral',
        ],
      },
      {
        id: 'headerFill',
        kind: 'color',
        defaultTokenId: 'builtin.box.theorem-math.header-neutral',
        allowedTokenIds: [
          'builtin.box.theorem-math.header-blue',
          'builtin.box.theorem-math.header-green',
          'builtin.box.theorem-math.header-amber',
          'builtin.box.theorem-math.header-red',
          'builtin.box.theorem-math.header-purple',
          'builtin.box.theorem-math.header-teal',
          'builtin.box.theorem-math.header-neutral',
        ],
      },
    ],
    variants: [
      {
        id: 'blue',
        label: '蓝色',
        description: '将定理双线框切换为蓝色。',
        tokenBindings: {
          accentColor: 'builtin.box.theorem-math.accent-blue',
          frameBorder: 'builtin.box.theorem-math.frame-blue',
          headerFill: 'builtin.box.theorem-math.header-blue',
        },
      },
      {
        id: 'green',
        label: '绿色',
        description: '将定理双线框切换为绿色。',
        tokenBindings: {
          accentColor: 'builtin.box.theorem-math.accent-green',
          frameBorder: 'builtin.box.theorem-math.frame-green',
          headerFill: 'builtin.box.theorem-math.header-green',
        },
      },
      {
        id: 'amber',
        label: '琥珀',
        description: '将定理双线框切换为琥珀色。',
        tokenBindings: {
          accentColor: 'builtin.box.theorem-math.accent-amber',
          frameBorder: 'builtin.box.theorem-math.frame-amber',
          headerFill: 'builtin.box.theorem-math.header-amber',
        },
      },
      {
        id: 'red',
        label: '红色',
        description: '将定理双线框切换为红色。',
        tokenBindings: {
          accentColor: 'builtin.box.theorem-math.accent-red',
          frameBorder: 'builtin.box.theorem-math.frame-red',
          headerFill: 'builtin.box.theorem-math.header-red',
        },
      },
      {
        id: 'purple',
        label: '紫色',
        description: '将定理双线框切换为紫色。',
        tokenBindings: {
          accentColor: 'builtin.box.theorem-math.accent-purple',
          frameBorder: 'builtin.box.theorem-math.frame-purple',
          headerFill: 'builtin.box.theorem-math.header-purple',
        },
      },
      {
        id: 'teal',
        label: '青色',
        description: '将定理双线框切换为青色。',
        tokenBindings: {
          accentColor: 'builtin.box.theorem-math.accent-teal',
          frameBorder: 'builtin.box.theorem-math.frame-teal',
          headerFill: 'builtin.box.theorem-math.header-teal',
        },
      },
      {
        id: 'neutral',
        label: '中性',
        description: '将定理双线框切换为中性灰。',
        tokenBindings: {
          accentColor: 'builtin.box.theorem-math.accent-neutral',
          frameBorder: 'builtin.box.theorem-math.frame-neutral',
          headerFill: 'builtin.box.theorem-math.header-neutral',
        },
      },
    ],
  },
})
