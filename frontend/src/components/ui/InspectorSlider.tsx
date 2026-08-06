import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

export interface InspectorSliderProps {
  label: ReactNode
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
  presets?: number[]
  className?: string
}

export function InspectorSlider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit = '',
  presets,
  className = '',
}: InspectorSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [inputValue, setInputValue] = useState<string>(String(value))

  useEffect(() => {
    setInputValue(String(value))
  }, [value])

  const clampAndSnap = useCallback((val: number) => {
    const clamped = Math.min(max, Math.max(min, val))
    const precision = step.toString().split('.')[1]?.length || 0
    return Number(clamped.toFixed(precision))
  }, [min, max, step])

  const handlePointerUpdate = useCallback((clientX: number) => {
    if (!trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const rawVal = min + ratio * (max - min)
    const steps = Math.round((rawVal - min) / step)
    const snapped = clampAndSnap(min + steps * step)
    onChange(snapped)
  }, [min, max, step, clampAndSnap, onChange])

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsDragging(true)
    handlePointerUpdate(e.clientX)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return
    handlePointerUpdate(e.clientX)
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      e.currentTarget.releasePointerCapture(e.pointerId)
      setIsDragging(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    let next = value
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      next = value + step
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      next = value - step
    } else if (e.key === 'PageUp') {
      next = value + step * 5
    } else if (e.key === 'PageDown') {
      next = value - step * 5
    } else if (e.key === 'Home') {
      next = min
    } else if (e.key === 'End') {
      next = max
    } else {
      return
    }
    e.preventDefault()
    onChange(clampAndSnap(next))
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
  }

  const handleInputBlur = () => {
    const parsed = Number.parseFloat(inputValue)
    if (Number.isNaN(parsed)) {
      setInputValue(String(value))
    } else {
      const snapped = clampAndSnap(parsed)
      onChange(snapped)
      setInputValue(String(snapped))
    }
  }

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    }
  }

  const percentage = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))

  return (
    <div className={`space-y-1.5 select-none ${className}`}>
      {/* 标签与数字输入框同行 */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</span>
        <div className="flex items-center gap-1">
          <div className="relative flex items-center">
            <input
              type="number"
              min={min}
              max={max}
              step={step}
              value={inputValue}
              onChange={handleInputChange}
              onBlur={handleInputBlur}
              onKeyDown={handleInputKeyDown}
              className="h-6 w-16 rounded border border-zinc-200 bg-white/80 px-1.5 text-right font-mono text-xs tabular-nums text-zinc-800 outline-none transition-colors hover:border-zinc-300 focus:border-zinc-400 focus:bg-white focus:ring-1 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-200 dark:hover:border-zinc-700 dark:focus:border-zinc-600 dark:focus:bg-zinc-900 dark:focus:ring-zinc-600"
            />
            {unit && <span className="ml-1 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">{unit}</span>}
          </div>
        </div>
      </div>

      {/* 预设快选胶囊 */}
      {presets && presets.length > 0 && (
        <div className="flex items-center gap-1.5">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onChange(preset)}
              className={`flex-1 h-5 rounded text-[10px] font-medium transition-colors ${
                Math.abs(value - preset) < step / 2
                  ? 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-400 dark:hover:bg-zinc-800'
              }`}
            >
              {preset}
              {unit}
            </button>
          ))}
        </div>
      )}

      {/* 2px 轨道 + 12px 白色描边滑块 */}
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="relative flex h-4 w-full cursor-pointer items-center touch-none"
      >
        {/* 2px 浅灰轨道 */}
        <div className="relative h-[2px] w-full rounded-full bg-zinc-200 dark:bg-zinc-800">
          {/* 深灰激活区 */}
          <div
            className="h-[2px] rounded-full bg-zinc-800 dark:bg-zinc-200"
            style={{ width: `${percentage}%` }}
          />
        </div>

        {/* 12px 白色描边滑块，仅键盘聚焦显示 focus ring */}
        <div
          role="slider"
          tabIndex={0}
          aria-label={typeof label === 'string' ? label : '属性数值'}
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max}
          onKeyDown={handleKeyDown}
          className="absolute -translate-x-1/2 size-3 rounded-full border border-zinc-300 bg-white shadow-xs transition-transform hover:scale-110 active:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-1 dark:border-zinc-600 dark:bg-zinc-100 dark:focus-visible:ring-zinc-300 dark:focus-visible:ring-offset-zinc-950"
          style={{ left: `${percentage}%` }}
        />
      </div>
    </div>
  )
}
