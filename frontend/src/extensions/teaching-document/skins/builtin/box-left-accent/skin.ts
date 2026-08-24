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
})
