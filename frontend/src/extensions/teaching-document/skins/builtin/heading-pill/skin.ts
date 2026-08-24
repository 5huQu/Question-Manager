import './styles.css'
import { defineHeadingSkin } from '@/utils/teachingDocument/skins/authoring'

export default defineHeadingSkin({
  id: 'builtin.heading.pill',
  label: '圆角标签标题',
  description: '带低对比圆角底色的章节标题。',
  version: 1,
  printSafe: true,
  className: 'td-skin-heading-pill',
  supportedLevels: [1, 2, 3, 4],
  tags: ['builtin', 'heading'],
})
