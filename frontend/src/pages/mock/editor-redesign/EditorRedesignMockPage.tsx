/**
 * 讲义编辑器 UI 重设计 Mock 入口
 * 路由：/mock/editor-redesign（仅 DEV 环境）
 * 通过 Tab 切换三个设计方向的可交互原型
 */

import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Focus, Keyboard, LayoutGrid } from 'lucide-react'
import { DirectionA_FocusCanvas } from './DirectionA_FocusCanvas'
import { DirectionB_CommandCenter } from './DirectionB_CommandCenter'
import { DirectionC_PageStudio } from './DirectionC_PageStudio'
import { springDefault } from './shared/MotionPrimitives'

type Direction = 'A' | 'B' | 'C'

const DIRECTIONS: { key: Direction; label: string; sub: string; icon: typeof Focus }[] = [
  { key: 'A', label: 'Focus Canvas', sub: '聚焦画布 · 内容优先', icon: Focus },
  { key: 'B', label: 'Command Center', sub: '命令中心 · 键盘驱动', icon: Keyboard },
  { key: 'C', label: 'Page Studio', sub: '页面工作室 · 排版预览', icon: LayoutGrid },
]

export default function EditorRedesignMockPage() {
  const [active, setActive] = useState<Direction>('A')
  const reduced = useReducedMotion()

  return (
    <main className="space-y-4">
      {/* 页面头部 */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">设计原型 · 只读 Mock</p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">讲义编辑器 UI 重设计</h1>
          <p className="mt-1 text-[13px] text-zinc-500">三个界面方向的可交互原型。所有编辑操作仅在本地 state，不触发真实 API。</p>
        </div>
      </div>

      {/* 方向切换 Tabs */}
      <div className="flex items-center gap-1 rounded-xl border border-zinc-200 bg-zinc-100/80 p-1 dark:border-zinc-800 dark:bg-zinc-900/80">
        {DIRECTIONS.map(({ key, label, sub, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActive(key)}
            className={`relative flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-left transition-colors ${
              active === key
                ? 'text-zinc-900 dark:text-zinc-50'
                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            {active === key && (
              <motion.div
                layoutId="direction-tab-bg"
                className="absolute inset-0 rounded-lg border border-zinc-200/50 bg-white shadow-sm dark:border-zinc-700/50 dark:bg-zinc-950"
                transition={reduced ? { duration: 0.1 } : springDefault}
              />
            )}
            <span className="relative flex items-center gap-2">
              <Icon className="size-4" />
              <span>
                <span className="block text-xs font-semibold">{label}</span>
                <span className="block text-[10px] text-zinc-400">{sub}</span>
              </span>
            </span>
          </button>
        ))}
      </div>

      {/* 方向内容 */}
      <div className="relative">
        {active === 'A' && <DirectionA_FocusCanvas />}
        {active === 'B' && <DirectionB_CommandCenter />}
        {active === 'C' && <DirectionC_PageStudio />}
      </div>

      {/* 方向说明 */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <DirectionDescription active={active} />
      </div>
    </main>
  )
}

function DirectionDescription({ active }: { active: Direction }) {
  const descriptions: Record<Direction, { title: string; points: string[]; fit: string }> = {
    A: {
      title: 'Direction A: Focus Canvas (聚焦画布)',
      points: [
        '全宽画布，左侧大纲收缩为图标栏（点击展开为 translucent overlay）',
        '块选中时出现 floating contextual toolbar（紧贴块上方）',
        '拖拽排序使用 spring physics + velocity handoff',
        '插入通过块间 "+" 按钮触发，弹出类型选择 popover',
        '右侧属性面板作为 overlay sheet 从右滑入（backdrop-blur material）',
      ],
      fit: '适合沉浸式内容编辑、大屏工作环境',
    },
    B: {
      title: 'Direction B: Command Center (命令中心)',
      points: [
        '保留三栏布局但改善比例和视觉层次',
        'Cmd+K 命令面板：快速插入块、跳转块、切换视图模式',
        '左栏大纲支持拖拽排序（Reorder + spring 动画）',
        '右栏属性面板按"内容 / 布局 / 高级"分组 accordion',
        '块 hover 显示行号 gutter + 快捷操作图标',
      ],
      fit: '适合高效键盘用户、复杂长文档',
    },
    C: {
      title: 'Direction C: Page Studio (页面工作室)',
      points: [
        '以"页"为单位浏览，左侧缩略图 filmstrip + 中央大预览',
        '页面切换使用方向暗示动画（从点击方向滑入）',
        '块编辑通过双击弹出 bottom sheet（spring 从底部滑入）',
        '底部 sticky bar 显示页码、块统计、保存状态',
        '缩放控制 + 当前页指示器动画（layoutId shared element）',
      ],
      fit: '适合排版预览为主、导出前检查',
    },
  }
  const desc = descriptions[active]
  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{desc.title}</h3>
      <ul className="mt-2 space-y-1">
        {desc.points.map((point, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-300">
            <span className="mt-1 size-1 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600" />
            {point}
          </li>
        ))}
      </ul>
      <p className="mt-3 rounded-md bg-zinc-50 px-3 py-2 text-[11px] text-zinc-500 dark:bg-zinc-900/50 dark:text-zinc-400">
        适用场景：{desc.fit}
      </p>
    </div>
  )
}
