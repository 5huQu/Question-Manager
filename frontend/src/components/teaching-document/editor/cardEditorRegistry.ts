/**
 * 卡片流编辑器注册表
 *
 * 用途：
 * - 追踪当前获得焦点的卡片流编辑器（全文同时只有一个），
 *   供顶栏"插入"菜单把插入动作路由到光标处（类 Word：光标在哪，对象落哪）；
 * - 浮动的文字格式工具栏需要把 InlineFormattingControls 接到卡片编辑器
 *   而非文档级编辑器。
 */
import type { Editor } from '@tiptap/react'
import type { BoxChildBlock, TeachingBlock } from '@/types/teachingDocument'
import { newTeachingBlock } from '@/utils/teachingDocument'
import { blockToEditorNode } from './serialization'

let activeEditor: Editor | null = null
const listeners = new Set<(editor: Editor | null) => void>()

export function getFocusedCardEditor(): Editor | null {
  return activeEditor
}

export function subscribeFocusedCardEditor(listener: (editor: Editor | null) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function registerCardEditorFocus(editor: Editor | null) {
  if (activeEditor === editor) return
  activeEditor = editor
  for (const listener of listeners) listener(editor)
}

/** 仅当仍由指定编辑器占用焦点时清除，避免相邻编辑器切换时误清空新焦点。 */
export function clearCardEditorFocus(editor: Editor) {
  if (activeEditor === editor) registerCardEditorFocus(null)
}

/**
 * 在卡片流编辑器光标处插入子块。
 * 光标位于段落内部时，ProseMirror 会自动把段落拆成两段，文字环绕对象；
 * 序列化回写 children 后即为"段落 + 对象 + 段落"。
 */
export function insertCardBlockAtCaret(editor: Editor, type: TeachingBlock['type']): BoxChildBlock | null {
  const child = newTeachingBlock(type) as BoxChildBlock
  const node = blockToEditorNode(child as TeachingBlock)
  if (!node) return null
  editor.chain().focus().insertContent(node).run()
  return child
}
