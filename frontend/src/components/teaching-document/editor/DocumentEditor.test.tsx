import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Editor } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'
import { describe, expect, it, vi } from 'vitest'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { DocumentEditor } from './DocumentEditor'
import { insertTopLevelTeachingBlock } from './structuralActions'
import { blockIdFromEditorSelection } from './selection'

function documentWithContent(content: TeachingDocumentV1['content']): TeachingDocumentV1 {
  return {
    version: 1,
    documentType: 'lecture',
    title: '测试讲义',
    metadata: {},
    content,
  }
}

describe('DocumentEditor external insertion', () => {
  it('does not turn an externally inserted heading into an empty document after typing', async () => {
    const onChange = vi.fn()
    const editorRef: { current: Editor | null } = { current: null }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <DocumentEditor
          document={documentWithContent([])}
          onChange={onChange}
          modelSyncDelayMs={0}
          onEditorReady={(instance) => { editorRef.current = instance }}
        />,
      )
    })
    expect(editorRef.current).not.toBeNull()

    const headingDocument = documentWithContent([{
      type: 'heading',
      id: 'heading-1',
      level: 3,
      content: [{ type: 'text', text: '新标题' }],
    }])
    await act(async () => {
      root.render(
        <DocumentEditor
          document={headingDocument}
          onChange={onChange}
          modelSyncDelayMs={0}
          onEditorReady={(instance) => { editorRef.current = instance }}
        />,
      )
    })
    expect(editorRef.current).not.toBeNull()
    const currentEditor = editorRef.current
    if (!currentEditor) throw new Error('编辑器未就绪')
    {
      expect(currentEditor.getJSON().content?.[0]).toMatchObject({
        type: 'docHeading',
        attrs: { blockId: 'heading-1' },
      })
    }

    await act(async () => {
      currentEditor.commands.setTextSelection(4)
      currentEditor.commands.insertContent('内容')
    })

    expect(onChange).toHaveBeenCalled()
    const emitted = onChange.mock.calls.at(-1)?.[0] as TeachingDocumentV1
    expect(emitted.content).toHaveLength(1)
    expect(emitted.content[0]).toMatchObject({
      type: 'heading',
      id: 'heading-1',
    })
    act(() => root.unmount())
    container.remove()
  })

  it('keeps the caret in the edited block when an external attrs-only sync replaces the document', async () => {
    const editorRef: { current: Editor | null } = { current: null }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const headings = (firstSkin?: { id: string; version: number }) => documentWithContent([
      {
        type: 'heading',
        id: 'heading-1',
        level: 1,
        content: [{ type: 'text', text: '统一预备知识' }],
        ...(firstSkin ? { skin: firstSkin } : {}),
      },
      {
        type: 'heading',
        id: 'heading-2',
        level: 2,
        content: [{ type: 'text', text: '下一节标题' }],
      },
    ])
    try {
      await act(async () => {
        root.render(
          <DocumentEditor
            document={headings()}
            onChange={() => undefined}
            onEditorReady={(instance) => { editorRef.current = instance }}
          />,
        )
      })
      const editor = editorRef.current
      if (!editor) throw new Error('编辑器未就绪')
      // 光标落在第一个标题文本内（用户正在编辑该标题）
      await act(async () => {
        editor.commands.setTextSelection(3)
      })
      expect(blockIdFromEditorSelection(editor.state)).toBe('heading-1')
      expect(editor.state.selection.anchor).toBe(3)

      // 外部属性更新（切换皮肤）：仅 attrs 变化，文本内容不变 → 走 setContent 整篇同步。
      await act(async () => {
        root.render(
          <DocumentEditor
            document={headings({ id: 'builtin.heading.left-accent', version: 1 })}
            onChange={() => undefined}
            onEditorReady={(instance) => { editorRef.current = instance }}
          />,
        )
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(editor.getJSON().content?.[0]).toMatchObject({
        type: 'docHeading',
        attrs: { blockId: 'heading-1', skin: JSON.stringify({ id: 'builtin.heading.left-accent', version: 1 }) },
      })
      // 选区不能被整篇同步抛到下一个标题上。
      expect(blockIdFromEditorSelection(editor.state)).toBe('heading-1')
      expect(editor.state.selection.anchor).toBe(3)
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })

  it('keeps an atom card selected when an external skin update replaces its attrs', async () => {
    const editorRef: { current: Editor | null } = { current: null }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const cards = (skin?: { id: string; version: number }) => documentWithContent([
      {
        type: 'box',
        id: 'box-1',
        templateId: 'concept',
        breakBehavior: 'auto',
        children: [],
        ...(skin ? { skin } : {}),
      },
      {
        type: 'heading',
        id: 'heading-after-box',
        level: 2,
        content: [{ type: 'text', text: '卡片后的标题' }],
      },
    ])
    try {
      await act(async () => {
        root.render(
          <DocumentEditor
            document={cards()}
            onChange={() => undefined}
            onEditorReady={(instance) => { editorRef.current = instance }}
          />,
        )
      })
      const editor = editorRef.current
      if (!editor) throw new Error('编辑器未就绪')
      await act(async () => {
        editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)))
      })
      expect(blockIdFromEditorSelection(editor.state)).toBe('box-1')

      await act(async () => {
        root.render(
          <DocumentEditor
            document={cards({ id: 'builtin.box.left-accent', version: 1 })}
            onChange={() => undefined}
            onEditorReady={(instance) => { editorRef.current = instance }}
          />,
        )
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(editor.state.selection).toBeInstanceOf(NodeSelection)
      expect(blockIdFromEditorSelection(editor.state)).toBe('box-1')
      expect(editor.getJSON().content?.[0]).toMatchObject({
        type: 'docBox',
        attrs: { blockId: 'box-1', skin: JSON.stringify({ id: 'builtin.box.left-accent', version: 1 }) },
      })
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })

  it('creates an externally inserted page-break NodeView outside the React effect lifecycle', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const editorRef: { current: Editor | null } = { current: null }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(
          <DocumentEditor
            document={documentWithContent([{ type: 'paragraph', id: 'p-1', content: [{ type: 'text', text: '正文' }] }])}
            onChange={() => undefined}
            onEditorReady={(instance) => { editorRef.current = instance }}
          />,
        )
      })
      await act(async () => {
        root.render(
          <DocumentEditor
            document={documentWithContent([
              { type: 'paragraph', id: 'p-1', content: [{ type: 'text', text: '正文' }] },
              { type: 'pageBreak', id: 'break-1' },
            ])}
            onChange={() => undefined}
            onEditorReady={(instance) => { editorRef.current = instance }}
          />,
        )
        await Promise.resolve()
      })

      expect(editorRef.current?.getJSON().content?.map((node) => node.attrs?.blockId)).toEqual(['p-1', 'break-1'])
      expect(consoleError.mock.calls.flat().join(' ')).not.toContain('flushSync was called from inside a lifecycle method')
    } finally {
      act(() => root.unmount())
      container.remove()
      consoleError.mockRestore()
    }
  })
})

describe('DocumentEditor model synchronization', () => {
  it('waits until typing becomes idle before synchronizing the latest snapshot', async () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    const editorRef: { current: Editor | null } = { current: null }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(
          <DocumentEditor
            document={documentWithContent([{ type: 'paragraph', id: 'p-1', content: [{ type: 'text', text: '甲' }] }])}
            onChange={onChange}
            modelSyncDelayMs={350}
            onEditorReady={(instance) => { editorRef.current = instance }}
          />,
        )
      })
      const editor = editorRef.current
      if (!editor) throw new Error('编辑器未就绪')
      await act(async () => {
        editor.commands.setTextSelection(2)
        editor.commands.insertContent('乙')
      })
      expect(onChange).not.toHaveBeenCalled()

      await act(async () => { await vi.advanceTimersByTimeAsync(300) })
      await act(async () => { editor.commands.insertContent('丙') })
      await act(async () => { await vi.advanceTimersByTimeAsync(349) })
      expect(onChange).not.toHaveBeenCalled()
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange.mock.calls[0]?.[0].content[0]).toMatchObject({
        type: 'paragraph',
        id: 'p-1',
        content: [{ type: 'text', text: '甲乙丙' }],
      })
    } finally {
      act(() => root.unmount())
      container.remove()
      vi.useRealTimers()
    }
  })

  it('forwards a structural transaction change set with the deferred domain snapshot', async () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    const editorRef: { current: Editor | null } = { current: null }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(
          <DocumentEditor
            document={documentWithContent([
              { type: 'paragraph', id: 'a', content: [{ type: 'text', text: 'a' }] },
              { type: 'paragraph', id: 'b', content: [{ type: 'text', text: 'b' }] },
            ])}
            onChange={onChange}
            modelSyncDelayMs={350}
            onEditorReady={(instance) => { editorRef.current = instance }}
          />,
        )
      })
      const editor = editorRef.current
      if (!editor) throw new Error('编辑器未就绪')
      await act(async () => {
        insertTopLevelTeachingBlock(editor, { type: 'pageBreak', id: 'break' }, 'a')
      })
      expect(editor.getJSON().content?.map((node) => node.attrs?.blockId)).toEqual(['a', 'break', 'b'])
      expect(onChange).not.toHaveBeenCalled()

      await act(async () => { await vi.advanceTimersByTimeAsync(350) })
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange.mock.calls[0]?.[0].content.map((block: { id: string }) => block.id)).toEqual(['a', 'break', 'b'])
      expect(onChange.mock.calls[0]?.[1]).toMatchObject({
        dirtyBlockIds: ['break'],
        firstDirtyTopLevelIndex: 1,
        structureChanged: true,
      })
    } finally {
      act(() => root.unmount())
      container.remove()
      vi.useRealTimers()
    }
  })
})
