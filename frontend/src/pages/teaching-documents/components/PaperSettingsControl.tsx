import type { TeachingDocumentStyle, TeachingMarginPreset } from '@/types/teachingDocument'
import type { PaperSpec } from '@/utils/teachingDocument'

const paperFieldClass =
  'mt-1.5 h-9 w-full rounded-xl border border-black/10 bg-white/90 px-3 text-xs font-medium text-zinc-900 shadow-2xs outline-none transition-all focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-white/12 dark:bg-zinc-900/90 dark:text-zinc-100 dark:focus:border-zinc-100 dark:focus:ring-zinc-100'

export function PaperSettingsControl({
  paper,
  marginPreset,
  style,
  onChange,
}: {
  paper: PaperSpec
  marginPreset: TeachingMarginPreset
  style?: TeachingDocumentStyle
  onChange: (patch: Partial<TeachingDocumentStyle>) => void
}) {
  const updateMargins = (key: 'topMm' | 'rightMm' | 'bottomMm' | 'leftMm', value: number) => {
    onChange({
      paper: {
        ...style?.paper,
        margins: {
          topMm: style?.paper?.margins?.topMm ?? paper.marginTopMm,
          rightMm: style?.paper?.margins?.rightMm ?? paper.marginRightMm,
          bottomMm: style?.paper?.margins?.bottomMm ?? paper.marginBottomMm,
          leftMm: style?.paper?.margins?.leftMm ?? paper.marginLeftMm,
          [key]: Math.max(0, Number.isFinite(value) ? value : 0),
        },
      },
    })
  }

  const selectPreset = (preset: TeachingMarginPreset) => {
    const nextPaper = { ...style?.paper }
    delete nextPaper.margins
    onChange({ paper: nextPaper, marginPreset: preset })
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs font-semibold text-zinc-900 dark:text-zinc-100">
          纸张大小
          <select
            className={paperFieldClass}
            value={paper.size}
            onChange={(event) => onChange({ paper: { ...style?.paper, size: event.target.value as 'A3' | 'A4' } })}
          >
            <option value="A4">A4 (210 × 297 mm)</option>
            <option value="A3">A3 (297 × 420 mm)</option>
          </select>
        </label>
        <label className="block text-xs font-semibold text-zinc-900 dark:text-zinc-100">
          纸张方向
          <select
            className={paperFieldClass}
            value={paper.orientation}
            onChange={(event) => onChange({ paper: { ...style?.paper, orientation: event.target.value as 'portrait' | 'landscape' } })}
          >
            <option value="portrait">纵向 (Portrait)</option>
            <option value="landscape">横向 (Landscape)</option>
          </select>
        </label>
      </div>

      <label className="block text-xs font-semibold text-zinc-900 dark:text-zinc-100">
        页边距预设
        <select
          className={paperFieldClass}
          value={style?.paper?.margins ? 'custom' : marginPreset}
          onChange={(event) => {
            if (event.target.value !== 'custom') selectPreset(event.target.value as TeachingMarginPreset)
          }}
        >
          <option value="compact">紧凑边距 (Compact)</option>
          <option value="normal">标准边距 (Normal)</option>
          <option value="relaxed">宽松边距 (Relaxed)</option>
          <option value="custom">自定义边距 (Custom)</option>
        </select>
      </label>

      <div className="grid grid-cols-4 gap-2 pt-1">
        {([
          ['topMm', '上边距'],
          ['rightMm', '右边距'],
          ['bottomMm', '下边距'],
          ['leftMm', '左边距'],
        ] as const).map(([key, label]) => (
          <label key={key} className="block text-[11px] font-semibold text-zinc-900 dark:text-zinc-100">
            {label} (mm)
            <input
              className={paperFieldClass}
              type="number"
              min={0}
              max={100}
              step={1}
              value={paper[`margin${key.slice(0, 1).toUpperCase()}${key.slice(1, -2)}Mm` as 'marginTopMm' | 'marginRightMm' | 'marginBottomMm' | 'marginLeftMm']}
              onChange={(event) => updateMargins(key, Number(event.target.value))}
            />
          </label>
        ))}
      </div>
    </div>
  )
}
