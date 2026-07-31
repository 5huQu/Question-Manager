import {
  choiceLayoutFromColumns,
  type ChoiceLayoutOverrides,
} from '@/utils/choiceLayout'
import { TEACHING_DOM } from './domContract'

/**
 * 读取首轮自适应渲染的结果。只有 adaptive-* 是真实 DOM 探测产物；
 * 普通 four/two/one 是启发式回退，不能用于锁定纸张布局。
 */
export function measuredChoiceLayoutOverrides(
  root: ParentNode,
  currentOverrides: ChoiceLayoutOverrides = {},
): ChoiceLayoutOverrides {
  const overrides: Record<string, ReturnType<typeof choiceLayoutFromColumns>> = {}
  root.querySelectorAll<HTMLElement>(`[${TEACHING_DOM.questionChoiceLayout}]`).forEach((element) => {
    const blockId = element.getAttribute(TEACHING_DOM.questionChoiceLayoutBlockId)
    const layout = element.getAttribute(TEACHING_DOM.questionChoiceLayout) || ''
    const adaptiveMatch = /^adaptive-(1|2|4)$/.exec(layout)
    if (blockId && adaptiveMatch) {
      overrides[blockId] = choiceLayoutFromColumns(Number(adaptiveMatch[1]))
      return
    }

    // 第二轮会以固定 four/two/one 再渲染一次。保留已确认的结果，避免它被误判为
    // 首轮启发式值而清空，从而触发“探测 → 清空 → 再探测”的无限重排循环。
    if (blockId && currentOverrides[blockId]) {
      overrides[blockId] = currentOverrides[blockId]
    }
  })
  return overrides
}
