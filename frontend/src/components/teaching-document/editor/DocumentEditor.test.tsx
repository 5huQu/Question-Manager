import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Editor } from '@tiptap/react'
import { describe, expect, it, vi } from 'vitest'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { DocumentEditor } from './DocumentEditor'
import { insertTopLevelTeachingBlock } from './structuralActions'

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
