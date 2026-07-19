import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ManualFixHeader } from './ManualFixHeader'
import { ManualFixInspector } from './ManualFixInspector'
import type { ManualFixRegion, ManualFixTab } from './types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function click(label: string) {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)
  expect(button, `button ${label}`).toBeTruthy()
  act(() => button!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

function clickLast(label: string) {
  const buttons = [...container.querySelectorAll('button')].filter((item) => item.textContent?.trim() === label)
  expect(buttons.length, `button ${label}`).toBeGreaterThan(0)
  act(() => buttons.at(-1)!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

function inspector(overrides: Partial<React.ComponentProps<typeof ManualFixInspector>> = {}) {
  const props: React.ComponentProps<typeof ManualFixInspector> = {
    activeTab: 'content' as ManualFixTab,
    onTabChange: vi.fn(),
    candidate: {},
    stemMarkdown: '题干',
    answerText: '答案',
    analysisMarkdown: '解析',
    figures: [],
    regions: [],
    selectedRegionId: null,
    onStemChange: vi.fn(),
    onAnswerChange: vi.fn(),
    onAnalysisChange: vi.fn(),
    onAddRegion: vi.fn(),
    onDeleteSelected: vi.fn(),
    onRegionNoteChange: vi.fn(),
    onCleanHeaderFooter: vi.fn(),
    onLocateFigure: vi.fn(),
    onUpdateFigure: vi.fn(),
    onAssignTrailingOptions: vi.fn(),
    onDeleteFigure: vi.fn(),
    ...overrides,
  }
  act(() => root.render(<ManualFixInspector {...props} />))
  return props
}

describe('ManualFixInspector', () => {
  it('优先展示 issues，并在缺少 issues 时展示 parseDiagnostics', () => {
    inspector({ candidate: { issues: [{ message: '题干可能缺失' }], parseDiagnostics: [{ message: '解析备用提示' }] } })
    expect(container.textContent).toContain('题干可能缺失')
    expect(container.textContent).not.toContain('解析备用提示')

    act(() => root.render(<ManualFixInspector {...inspectorProps({ candidate: { parseDiagnostics: ['检测到跨题内容'] } })} />))
    expect(container.textContent).toContain('检测到跨题内容')
  })

  it('点击内容、选区和题图页签时返回对应值', () => {
    const onTabChange = vi.fn()
    inspector({ onTabChange })
    click('内容')
    click('选区')
    click('题图')
    expect(onTabChange.mock.calls.map(([tab]) => tab)).toEqual(['content', 'regions', 'figures'])
  })

  it('可新增三类选区，并删除当前选区', () => {
    const onAddRegion = vi.fn()
    const onDeleteSelected = vi.fn()
    const region: ManualFixRegion = {
      id: 'region-1',
      kind: 'question',
      questionLabel: '第 8 题题干',
      questionKeys: [],
      segments: [{ page: 2, x: 0.1, y: 0.1, width: 0.4, height: 0.2 }],
    }
    inspector({ activeTab: 'regions', regions: [region], selectedRegionId: region.id, onAddRegion, onDeleteSelected })
    click('题干')
    click('解析')
    clickLast('题图')
    click('删除')
    expect(onAddRegion.mock.calls.map(([kind]) => kind)).toEqual(['question', 'solution', 'shared_answer_key'])
    expect(onDeleteSelected).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('第 2 页')
  })

  it('题图为空时展示明确的空状态', () => {
    inspector({ activeTab: 'figures', figures: [] })
    expect(container.textContent).toContain('当前题目暂无题图')
  })

  it('可把题图改成指定选项图，并批量指定最后四张', () => {
    const onUpdateFigure = vi.fn()
    const onAssignTrailingOptions = vi.fn()
    inspector({
      activeTab: 'figures',
      figures: [1, 2, 3, 4].map((index) => ({ id: `figure-${index}`, path: `figure-${index}.png`, usage: index === 1 ? 'stem' : 'options', optionLabel: String.fromCharCode(64 + index) })),
      onUpdateFigure,
      onAssignTrailingOptions,
    })
    click('后四张设为 A-D')
    expect(onAssignTrailingOptions).toHaveBeenCalledOnce()
    const typeSelect = container.querySelector<HTMLSelectElement>('select[aria-label="题图 1 类型"]')!
    act(() => {
      typeSelect.value = 'options'
      typeSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onUpdateFigure).toHaveBeenCalledWith(expect.objectContaining({ id: 'figure-1' }), 'options', undefined)
  })

  it('内容面板使用紧凑统一编辑器，并展示恢复与版本状态', () => {
    inspector({ candidate: { id: 'candidate-1' }, contentRevision: 4, recoveredDraft: true, contentDirty: true })
    expect(container.textContent).toContain('修正题目内容')
    expect(container.textContent).toContain('已恢复这道候选题上次未保存的本地内容')
    expect(container.textContent).toContain('版本 4')
    expect(container.textContent).toContain('有未保存修改')
    expect(container.querySelector('textarea')).toBeNull()
  })

  it('已入库冲突保留本地稿并指向题库', () => {
    inspector({ conflict: { message: '候选题已入库', committedQuestionId: 'question-9' } })
    expect(container.textContent).toContain('本地修改仍已保留')
    expect(container.querySelector<HTMLAnchorElement>('a')?.getAttribute('href')).toBe('/questions')
  })
})

function inspectorProps(overrides: Partial<React.ComponentProps<typeof ManualFixInspector>> = {}): React.ComponentProps<typeof ManualFixInspector> {
  return {
    activeTab: 'content', onTabChange: vi.fn(), candidate: {}, stemMarkdown: '', answerText: '', analysisMarkdown: '', figures: [], regions: [], selectedRegionId: null,
    onStemChange: vi.fn(), onAnswerChange: vi.fn(), onAnalysisChange: vi.fn(), onAddRegion: vi.fn(), onDeleteSelected: vi.fn(), onRegionNoteChange: vi.fn(), onCleanHeaderFooter: vi.fn(), onLocateFigure: vi.fn(), onUpdateFigure: vi.fn(), onAssignTrailingOptions: vi.fn(), onDeleteFigure: vi.fn(),
    ...overrides,
  }
}

describe('ManualFixHeader', () => {
  it('展示题号、文件名和选区保存状态', () => {
    act(() => root.render(<ManualFixHeader candidate={{ questionNo: 12 }} pdfName="期末试卷.pdf" saving finalizing={false} onBack={vi.fn()} onSaveDraft={vi.fn()} onFinalize={vi.fn()} />))
    expect(container.textContent).toContain('第 12 题 · 期末试卷.pdf')
    expect(container.textContent).toContain('保存中…')
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="返回候选题"]')).toBeTruthy()
    expect([...container.querySelectorAll('button')].find((button) => button.textContent === '保存草稿')?.disabled).toBe(true)
  })

  it('触发返回、保存草稿和完成修正回调，并展示提交状态', () => {
    const onBack = vi.fn()
    const onSaveDraft = vi.fn()
    const onFinalize = vi.fn()
    act(() => root.render(<ManualFixHeader candidate={{}} pdfName="试卷.pdf" saving={false} finalizing={false} onBack={onBack} onSaveDraft={onSaveDraft} onFinalize={onFinalize} />))
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="返回候选题"]')!.click())
    click('保存草稿')
    click('完成修正')
    expect(onBack).toHaveBeenCalledOnce()
    expect(onSaveDraft).toHaveBeenCalledOnce()
    expect(onFinalize).toHaveBeenCalledOnce()

    act(() => root.render(<ManualFixHeader candidate={{}} pdfName="试卷.pdf" saving={false} finalizing onBack={onBack} onSaveDraft={onSaveDraft} onFinalize={onFinalize} />))
    expect(container.textContent).toContain('正在提交…')
  })
})
