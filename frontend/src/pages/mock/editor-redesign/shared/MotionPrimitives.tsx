/**
 * 共享 Motion 原语
 * 遵循 Apple Design Skill 动效规范：
 * - 默认 spring: damping 1.0, response 0.4 (critically damped)
 * - 面板/抽屉: damping 0.8, response 0.3 (轻微弹跳)
 * - 按钮反馈: pointer-down scale(0.97)
 * - 尊重 prefers-reduced-motion
 */

import { motion, useReducedMotion, type Transition, type Variants } from 'motion/react'
import { type ReactNode, type ComponentPropsWithoutRef } from 'react'

// ─── Spring 配置 ─────────────────────────────────────────────────────────────

/** 默认 UI spring: critically damped, 无过冲 */
export const springDefault: Transition = {
  type: 'spring',
  bounce: 0,
  duration: 0.4,
}

/** 面板/抽屉 spring: 轻微弹跳 */
export const springPanel: Transition = {
  type: 'spring',
  bounce: 0.2,
  duration: 0.3,
}

/** 快速反馈 spring */
export const springQuick: Transition = {
  type: 'spring',
  bounce: 0,
  duration: 0.25,
}

// ─── 通用动画 Variants ────────────────────────────────────────────────────────

export const fadeSlideUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
}

export const fadeSlideRight: Variants = {
  hidden: { opacity: 0, x: 24 },
  visible: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 24 },
}

export const fadeSlideLeft: Variants = {
  hidden: { opacity: 0, x: -24 },
  visible: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -24 },
}

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.97 },
}

// ─── 按钮按压反馈 ─────────────────────────────────────────────────────────────

export function PressableButton({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<'button'> & { children: ReactNode }) {
  const reduced = useReducedMotion()
  return (
    <motion.button
      type="button"
      className={className}
      whileTap={reduced ? undefined : { scale: 0.97 }}
      transition={springQuick}
      {...(props as any)}
    >
      {children}
    </motion.button>
  )
}

// ─── 面板滑入容器 ─────────────────────────────────────────────────────────────

export function SlidePanel({
  children,
  className,
  direction = 'right',
}: {
  children: ReactNode
  className?: string
  direction?: 'left' | 'right'
}) {
  const reduced = useReducedMotion()
  const variants = direction === 'right' ? fadeSlideRight : fadeSlideLeft
  return (
    <motion.div
      className={className}
      variants={reduced ? undefined : variants}
      initial={reduced ? { opacity: 0 } : 'hidden'}
      animate={reduced ? { opacity: 1 } : 'visible'}
      exit={reduced ? { opacity: 0 } : 'exit'}
      transition={springPanel}
    >
      {children}
    </motion.div>
  )
}

// ─── 列表项布局动画 ───────────────────────────────────────────────────────────

export const listItemLayout = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, scale: 0.97 },
}

// ─── Reduced Motion 包装 ──────────────────────────────────────────────────────

export function useMotionConfig() {
  const reduced = useReducedMotion()
  return {
    reduced,
    transition: reduced
      ? { duration: 0.15, ease: 'easeInOut' as const }
      : springDefault,
    panelTransition: reduced
      ? { duration: 0.15, ease: 'easeInOut' as const }
      : springPanel,
  }
}
