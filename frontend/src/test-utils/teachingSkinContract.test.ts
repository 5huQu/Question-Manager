import { describe, expect, it } from 'vitest'
import { defineBoxSkin, defineHeadingSkin } from '@/utils/teachingDocument/skins/authoring'
import { describeTeachingSkinContract } from './teachingSkinContract'

const heading = defineHeadingSkin({
  id: 'test.contract.heading', label: '测试标题', version: 1, printSafe: true, className: 'td-skin-test-contract-heading', supportedLevels: [2],
})
const box = defineBoxSkin({
  id: 'test.contract.box', label: '测试卡片', version: 1, printSafe: true, className: 'td-skin-test-contract-box', supportedTemplates: ['concept'],
})

describeTeachingSkinContract(heading)
describeTeachingSkinContract(box)

describe('Teaching Skin contract helper isolation', () => {
  it('does not read the application registry to validate a definition', () => {
    expect(heading.id).toBe('test.contract.heading')
    expect(box.id).toBe('test.contract.box')
  })
})
