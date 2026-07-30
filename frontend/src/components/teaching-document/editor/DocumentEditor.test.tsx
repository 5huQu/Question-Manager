import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Editor } from '@tiptap/react'
import { describe, expect, it, vi } from 'vitest'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { DocumentEditor } from './DocumentEditor'

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
