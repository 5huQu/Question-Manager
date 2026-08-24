import './styles.css'
import { defineHeadingSkin } from '@/utils/teachingDocument/skins/types'

export default defineHeadingSkin({
  id: 'builtin.heading.left-accent',
  label: '左侧强调线',
  description: '以细左侧强调线标记章节层级。',
  version: 1,
  printSafe: true,
  className: 'td-skin-heading-left-accent',
  supportedLevels: [1, 2, 3, 4],
  tags: ['builtin', 'heading'],
})
