import './styles.css'
import { defineBoxSkin } from '@/utils/teachingDocument/skins/authoring'

export default defineBoxSkin({
  id: 'builtin.box.dashed-workspace',
  label: '虚线作答框',
  description: '浅色虚线边框，专为随堂演练与留白作答设计。',
  version: 1,
  printSafe: true,
  className: 'td-skin-box-dashed-workspace',
  supportedTemplates: ['practice', 'example', 'plain'],
  tags: ['builtin', 'box'],
  design: {
    tokens: [
      { id: 'builtin.box.dashed-workspace.border-neutral', kind: 'color', label: '中性边框颜色', printSafe: true, value: { hex: '#CBD5E1' } },
      { id: 'builtin.box.dashed-workspace.border-blue', kind: 'color', label: '浅蓝边框颜色', printSafe: true, value: { hex: '#BFDBFE' } },
      { id: 'builtin.box.dashed-workspace.border-green', kind: 'color', label: '浅绿边框颜色', printSafe: true, value: { hex: '#A7F3D0' } },
      { id: 'builtin.box.dashed-workspace.border-amber', kind: 'color', label: '浅琥珀边框颜色', printSafe: true, value: { hex: '#FDE68A' } },
      { id: 'builtin.box.dashed-workspace.border-red', kind: 'color', label: '浅红边框颜色', printSafe: true, value: { hex: '#FECACA' } },
      { id: 'builtin.box.dashed-workspace.border-purple', kind: 'color', label: '浅紫边框颜色', printSafe: true, value: { hex: '#DDD6FE' } },
      { id: 'builtin.box.dashed-workspace.border-teal', kind: 'color', label: '浅青边框颜色', printSafe: true, value: { hex: '#99F6E4' } },

      { id: 'builtin.box.dashed-workspace.header-neutral', kind: 'color', label: '中性标题背景', printSafe: true, value: { hex: '#FAFAFA' } },
      { id: 'builtin.box.dashed-workspace.header-blue', kind: 'color', label: '浅蓝标题背景', printSafe: true, value: { hex: '#EFF6FF' } },
      { id: 'builtin.box.dashed-workspace.header-green', kind: 'color', label: '浅绿标题背景', printSafe: true, value: { hex: '#ECFDF5' } },
      { id: 'builtin.box.dashed-workspace.header-amber', kind: 'color', label: '浅琥珀标题背景', printSafe: true, value: { hex: '#FFFBEB' } },
      { id: 'builtin.box.dashed-workspace.header-red', kind: 'color', label: '浅红标题背景', printSafe: true, value: { hex: '#FEF2F2' } },
      { id: 'builtin.box.dashed-workspace.header-purple', kind: 'color', label: '浅紫标题背景', printSafe: true, value: { hex: '#F5F3FF' } },
      { id: 'builtin.box.dashed-workspace.header-teal', kind: 'color', label: '浅青标题背景', printSafe: true, value: { hex: '#F0FDFA' } },

      { id: 'builtin.box.dashed-workspace.title-neutral', kind: 'color', label: '中性标题文字', printSafe: true, value: { hex: '#475569' } },
      { id: 'builtin.box.dashed-workspace.title-blue', kind: 'color', label: '蓝色标题文字', printSafe: true, value: { hex: '#1E40AF' } },
      { id: 'builtin.box.dashed-workspace.title-green', kind: 'color', label: '绿色标题文字', printSafe: true, value: { hex: '#065F46' } },
      { id: 'builtin.box.dashed-workspace.title-amber', kind: 'color', label: '琥珀标题文字', printSafe: true, value: { hex: '#92400E' } },
      { id: 'builtin.box.dashed-workspace.title-red', kind: 'color', label: '红色标题文字', printSafe: true, value: { hex: '#991B1B' } },
      { id: 'builtin.box.dashed-workspace.title-purple', kind: 'color', label: '紫色标题文字', printSafe: true, value: { hex: '#6D28D9' } },
      { id: 'builtin.box.dashed-workspace.title-teal', kind: 'color', label: '青色标题文字', printSafe: true, value: { hex: '#115E59' } },

      { id: 'builtin.box.dashed-workspace.frame-neutral', kind: 'border', label: '中性虚线框', printSafe: true, value: { widthPx: 1, style: 'dashed', colorTokenId: 'builtin.box.dashed-workspace.border-neutral' } },
      { id: 'builtin.box.dashed-workspace.frame-blue', kind: 'border', label: '浅蓝虚线框', printSafe: true, value: { widthPx: 1, style: 'dashed', colorTokenId: 'builtin.box.dashed-workspace.border-blue' } },
      { id: 'builtin.box.dashed-workspace.frame-green', kind: 'border', label: '浅绿虚线框', printSafe: true, value: { widthPx: 1, style: 'dashed', colorTokenId: 'builtin.box.dashed-workspace.border-green' } },
      { id: 'builtin.box.dashed-workspace.frame-amber', kind: 'border', label: '浅琥珀虚线框', printSafe: true, value: { widthPx: 1, style: 'dashed', colorTokenId: 'builtin.box.dashed-workspace.border-amber' } },
      { id: 'builtin.box.dashed-workspace.frame-red', kind: 'border', label: '浅红虚线框', printSafe: true, value: { widthPx: 1, style: 'dashed', colorTokenId: 'builtin.box.dashed-workspace.border-red' } },
      { id: 'builtin.box.dashed-workspace.frame-purple', kind: 'border', label: '浅紫虚线框', printSafe: true, value: { widthPx: 1, style: 'dashed', colorTokenId: 'builtin.box.dashed-workspace.border-purple' } },
      { id: 'builtin.box.dashed-workspace.frame-teal', kind: 'border', label: '浅青虚线框', printSafe: true, value: { widthPx: 1, style: 'dashed', colorTokenId: 'builtin.box.dashed-workspace.border-teal' } },
    ],
    slots: [
      {
        id: 'frameBorder',
        kind: 'border',
        defaultTokenId: 'builtin.box.dashed-workspace.frame-neutral',
        allowedTokenIds: [
          'builtin.box.dashed-workspace.frame-neutral',
          'builtin.box.dashed-workspace.frame-blue',
          'builtin.box.dashed-workspace.frame-green',
          'builtin.box.dashed-workspace.frame-amber',
          'builtin.box.dashed-workspace.frame-red',
          'builtin.box.dashed-workspace.frame-purple',
          'builtin.box.dashed-workspace.frame-teal',
        ],
      },
      {
        id: 'headerFill',
        kind: 'color',
        defaultTokenId: 'builtin.box.dashed-workspace.header-neutral',
        allowedTokenIds: [
          'builtin.box.dashed-workspace.header-neutral',
          'builtin.box.dashed-workspace.header-blue',
          'builtin.box.dashed-workspace.header-green',
          'builtin.box.dashed-workspace.header-amber',
          'builtin.box.dashed-workspace.header-red',
          'builtin.box.dashed-workspace.header-purple',
          'builtin.box.dashed-workspace.header-teal',
        ],
      },
      {
        id: 'titleColor',
        kind: 'color',
        defaultTokenId: 'builtin.box.dashed-workspace.title-neutral',
        allowedTokenIds: [
          'builtin.box.dashed-workspace.title-neutral',
          'builtin.box.dashed-workspace.title-blue',
          'builtin.box.dashed-workspace.title-green',
          'builtin.box.dashed-workspace.title-amber',
          'builtin.box.dashed-workspace.title-red',
          'builtin.box.dashed-workspace.title-purple',
          'builtin.box.dashed-workspace.title-teal',
        ],
      },
    ],
    variants: [
      {
        id: 'neutral',
        label: '中性',
        description: '切换为中性灰虚线作答框。',
        tokenBindings: {
          frameBorder: 'builtin.box.dashed-workspace.frame-neutral',
          headerFill: 'builtin.box.dashed-workspace.header-neutral',
          titleColor: 'builtin.box.dashed-workspace.title-neutral',
        },
      },
      {
        id: 'blue',
        label: '蓝色',
        description: '切换为浅蓝虚线作答框。',
        tokenBindings: {
          frameBorder: 'builtin.box.dashed-workspace.frame-blue',
          headerFill: 'builtin.box.dashed-workspace.header-blue',
          titleColor: 'builtin.box.dashed-workspace.title-blue',
        },
      },
      {
        id: 'green',
        label: '绿色',
        description: '切换为浅绿虚线作答框。',
        tokenBindings: {
          frameBorder: 'builtin.box.dashed-workspace.frame-green',
          headerFill: 'builtin.box.dashed-workspace.header-green',
          titleColor: 'builtin.box.dashed-workspace.title-green',
        },
      },
      {
        id: 'amber',
        label: '琥珀',
        description: '切换为浅琥珀虚线作答框。',
        tokenBindings: {
          frameBorder: 'builtin.box.dashed-workspace.frame-amber',
          headerFill: 'builtin.box.dashed-workspace.header-amber',
          titleColor: 'builtin.box.dashed-workspace.title-amber',
        },
      },
      {
        id: 'red',
        label: '红色',
        description: '切换为浅红虚线作答框。',
        tokenBindings: {
          frameBorder: 'builtin.box.dashed-workspace.frame-red',
          headerFill: 'builtin.box.dashed-workspace.header-red',
          titleColor: 'builtin.box.dashed-workspace.title-red',
        },
      },
      {
        id: 'purple',
        label: '紫色',
        description: '切换为浅紫虚线作答框。',
        tokenBindings: {
          frameBorder: 'builtin.box.dashed-workspace.frame-purple',
          headerFill: 'builtin.box.dashed-workspace.header-purple',
          titleColor: 'builtin.box.dashed-workspace.title-purple',
        },
      },
      {
        id: 'teal',
        label: '青色',
        description: '切换为浅青虚线作答框。',
        tokenBindings: {
          frameBorder: 'builtin.box.dashed-workspace.frame-teal',
          headerFill: 'builtin.box.dashed-workspace.header-teal',
          titleColor: 'builtin.box.dashed-workspace.title-teal',
        },
      },
    ],
  },
})
