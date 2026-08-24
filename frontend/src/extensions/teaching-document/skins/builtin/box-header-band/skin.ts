import './styles.css'
import { defineBoxSkin } from '@/utils/teachingDocument/skins/authoring'

export default defineBoxSkin({
  id: 'builtin.box.header-band',
  label: '深色标题带',
  description: '标题栏使用稳定的深色带状视觉。',
  version: 1,
  printSafe: true,
  className: 'td-skin-box-header-band',
  tags: ['builtin', 'box'],
})
