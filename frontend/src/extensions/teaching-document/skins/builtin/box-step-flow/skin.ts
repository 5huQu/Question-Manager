import './styles.css'
import { defineBoxSkin } from '@/utils/teachingDocument/skins/authoring'

export default defineBoxSkin({
  id: 'builtin.box.step-flow',
  label: '步骤流程拆解框',
  description: '结构化流程卡片，专为大题规范解答四步法与方法总结设计。',
  version: 1,
  printSafe: true,
  className: 'td-skin-box-step-flow',
  supportedTemplates: ['method', 'summary', 'practice', 'example', 'concept', 'plain'],
  tags: ['builtin', 'box'],
  design: {
    tokens: [
      { id: 'builtin.box.step-flow.accent-purple', kind: 'color', label: '紫色强调色', printSafe: true, value: { hex: '#7C3AED' } },
      { id: 'builtin.box.step-flow.accent-blue', kind: 'color', label: '蓝色强调色', printSafe: true, value: { hex: '#2563EB' } },
      { id: 'builtin.box.step-flow.accent-green', kind: 'color', label: '绿色强调色', printSafe: true, value: { hex: '#047857' } },
      { id: 'builtin.box.step-flow.accent-amber', kind: 'color', label: '琥珀强调色', printSafe: true, value: { hex: '#B45309' } },
      { id: 'builtin.box.step-flow.accent-red', kind: 'color', label: '红色强调色', printSafe: true, value: { hex: '#B91C1C' } },
      { id: 'builtin.box.step-flow.accent-teal', kind: 'color', label: '青色强调色', printSafe: true, value: { hex: '#0F766E' } },
      { id: 'builtin.box.step-flow.accent-neutral', kind: 'color', label: '中性强调色', printSafe: true, value: { hex: '#64748B' } },

      { id: 'builtin.box.step-flow.border-purple', kind: 'color', label: '浅紫边框', printSafe: true, value: { hex: '#DDD6FE' } },
      { id: 'builtin.box.step-flow.border-blue', kind: 'color', label: '浅蓝边框', printSafe: true, value: { hex: '#BFDBFE' } },
      { id: 'builtin.box.step-flow.border-green', kind: 'color', label: '浅绿边框', printSafe: true, value: { hex: '#A7F3D0' } },
      { id: 'builtin.box.step-flow.border-amber', kind: 'color', label: '浅琥珀边框', printSafe: true, value: { hex: '#FDE68A' } },
      { id: 'builtin.box.step-flow.border-red', kind: 'color', label: '浅红边框', printSafe: true, value: { hex: '#FECACA' } },
      { id: 'builtin.box.step-flow.border-teal', kind: 'color', label: '浅青边框', printSafe: true, value: { hex: '#99F6E4' } },
      { id: 'builtin.box.step-flow.border-neutral', kind: 'color', label: '中性边框', printSafe: true, value: { hex: '#E2E8F0' } },

      { id: 'builtin.box.step-flow.header-purple', kind: 'color', label: '浅紫标题背景', printSafe: true, value: { hex: '#F5F3FF' } },
      { id: 'builtin.box.step-flow.header-blue', kind: 'color', label: '浅蓝标题背景', printSafe: true, value: { hex: '#EFF6FF' } },
      { id: 'builtin.box.step-flow.header-green', kind: 'color', label: '浅绿标题背景', printSafe: true, value: { hex: '#ECFDF5' } },
      { id: 'builtin.box.step-flow.header-amber', kind: 'color', label: '浅琥珀标题背景', printSafe: true, value: { hex: '#FFFBEB' } },
      { id: 'builtin.box.step-flow.header-red', kind: 'color', label: '浅红标题背景', printSafe: true, value: { hex: '#FEF2F2' } },
      { id: 'builtin.box.step-flow.header-teal', kind: 'color', label: '浅青标题背景', printSafe: true, value: { hex: '#F0FDFA' } },
      { id: 'builtin.box.step-flow.header-neutral', kind: 'color', label: '中性标题背景', printSafe: true, value: { hex: '#F1F5F9' } },

      { id: 'builtin.box.step-flow.frame-purple', kind: 'border', label: '浅紫边框', printSafe: true, value: { widthPx: 1, style: 'solid', colorTokenId: 'builtin.box.step-flow.border-purple' } },
      { id: 'builtin.box.step-flow.frame-blue', kind: 'border', label: '浅蓝边框', printSafe: true, value: { widthPx: 1, style: 'solid', colorTokenId: 'builtin.box.step-flow.border-blue' } },
      { id: 'builtin.box.step-flow.frame-green', kind: 'border', label: '浅绿边框', printSafe: true, value: { widthPx: 1, style: 'solid', colorTokenId: 'builtin.box.step-flow.border-green' } },
      { id: 'builtin.box.step-flow.frame-amber', kind: 'border', label: '浅琥珀边框', printSafe: true, value: { widthPx: 1, style: 'solid', colorTokenId: 'builtin.box.step-flow.border-amber' } },
      { id: 'builtin.box.step-flow.frame-red', kind: 'border', label: '浅红边框', printSafe: true, value: { widthPx: 1, style: 'solid', colorTokenId: 'builtin.box.step-flow.border-red' } },
      { id: 'builtin.box.step-flow.frame-teal', kind: 'border', label: '浅青边框', printSafe: true, value: { widthPx: 1, style: 'solid', colorTokenId: 'builtin.box.step-flow.border-teal' } },
      { id: 'builtin.box.step-flow.frame-neutral', kind: 'border', label: '中性边框', printSafe: true, value: { widthPx: 1, style: 'solid', colorTokenId: 'builtin.box.step-flow.border-neutral' } },
    ],
    slots: [
      {
        id: 'accentColor',
        kind: 'color',
        defaultTokenId: 'builtin.box.step-flow.accent-neutral',
        allowedTokenIds: [
          'builtin.box.step-flow.accent-purple',
          'builtin.box.step-flow.accent-blue',
          'builtin.box.step-flow.accent-green',
          'builtin.box.step-flow.accent-amber',
          'builtin.box.step-flow.accent-red',
          'builtin.box.step-flow.accent-teal',
          'builtin.box.step-flow.accent-neutral',
        ],
      },
      {
        id: 'frameBorder',
        kind: 'border',
        defaultTokenId: 'builtin.box.step-flow.frame-neutral',
        allowedTokenIds: [
          'builtin.box.step-flow.frame-purple',
          'builtin.box.step-flow.frame-blue',
          'builtin.box.step-flow.frame-green',
          'builtin.box.step-flow.frame-amber',
          'builtin.box.step-flow.frame-red',
          'builtin.box.step-flow.frame-teal',
          'builtin.box.step-flow.frame-neutral',
        ],
      },
      {
        id: 'headerFill',
        kind: 'color',
        defaultTokenId: 'builtin.box.step-flow.header-neutral',
        allowedTokenIds: [
          'builtin.box.step-flow.header-purple',
          'builtin.box.step-flow.header-blue',
          'builtin.box.step-flow.header-green',
          'builtin.box.step-flow.header-amber',
          'builtin.box.step-flow.header-red',
          'builtin.box.step-flow.header-teal',
          'builtin.box.step-flow.header-neutral',
        ],
      },
    ],
    variants: [
      {
        id: 'purple',
        label: '紫色',
        description: '切换为紫色步骤卡。',
        tokenBindings: {
          accentColor: 'builtin.box.step-flow.accent-purple',
          frameBorder: 'builtin.box.step-flow.frame-purple',
          headerFill: 'builtin.box.step-flow.header-purple',
        },
      },
      {
        id: 'blue',
        label: '蓝色',
        description: '切换为蓝色步骤卡。',
        tokenBindings: {
          accentColor: 'builtin.box.step-flow.accent-blue',
          frameBorder: 'builtin.box.step-flow.frame-blue',
          headerFill: 'builtin.box.step-flow.header-blue',
        },
      },
      {
        id: 'green',
        label: '绿色',
        description: '切换为绿色步骤卡。',
        tokenBindings: {
          accentColor: 'builtin.box.step-flow.accent-green',
          frameBorder: 'builtin.box.step-flow.frame-green',
          headerFill: 'builtin.box.step-flow.header-green',
        },
      },
      {
        id: 'amber',
        label: '琥珀',
        description: '切换为琥珀步骤卡。',
        tokenBindings: {
          accentColor: 'builtin.box.step-flow.accent-amber',
          frameBorder: 'builtin.box.step-flow.frame-amber',
          headerFill: 'builtin.box.step-flow.header-amber',
        },
      },
      {
        id: 'red',
        label: '红色',
        description: '切换为红色步骤卡。',
        tokenBindings: {
          accentColor: 'builtin.box.step-flow.accent-red',
          frameBorder: 'builtin.box.step-flow.frame-red',
          headerFill: 'builtin.box.step-flow.header-red',
        },
      },
      {
        id: 'teal',
        label: '青色',
        description: '切换为青色步骤卡。',
        tokenBindings: {
          accentColor: 'builtin.box.step-flow.accent-teal',
          frameBorder: 'builtin.box.step-flow.frame-teal',
          headerFill: 'builtin.box.step-flow.header-teal',
        },
      },
      {
        id: 'neutral',
        label: '中性',
        description: '切换为中性灰步骤卡。',
        tokenBindings: {
          accentColor: 'builtin.box.step-flow.accent-neutral',
          frameBorder: 'builtin.box.step-flow.frame-neutral',
          headerFill: 'builtin.box.step-flow.header-neutral',
        },
      },
    ],
  },
})
