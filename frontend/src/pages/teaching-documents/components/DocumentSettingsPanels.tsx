import { useEffect, useState } from 'react'
import { Bold, Download, FileUp, Italic } from 'lucide-react'
import type { TeachingDocumentPrintOptions, TeachingDocumentStyle, TeachingMarginPreset, PrintChromeContentType, PrintChromeSlot, PrintChromeSlotPosition } from '@/types/teachingDocument'
import type { PaperSpec, PrintLayoutSpec } from '@/utils/teachingDocument'
import { teachingDocumentsApi, type PrintChromeTemplate } from '@/api/teachingDocuments'
import { TEXT_FONT_OPTIONS } from '@/utils/teachingDocument/lectureFonts'
import type { PrintChromeSection } from '@/components/teaching-document/PrintChrome'

const CHROME_CONTENT_OPTIONS: Array<{ value: PrintChromeContentType; label: string }> = [
  { value: 'none', label: '留空' },
  { value: 'customText', label: '自定义文字' },
  { value: 'documentTitle', label: '文档标题' },
  { value: 'pageNumber', label: '当前页码' },
  { value: 'totalPages', label: '总页数' },
  { value: 'date', label: '日期' },
]

const PAGE_NUMBER_FORMAT_OPTIONS = [
  { value: 'number', label: '3' },
  { value: 'page', label: '第 3 页' },
  { value: 'fraction', label: '3 / 4' },
  { value: 'page-total', label: '第 3 页，共 4 页' },
  { value: 'dash', label: '- 3 -' },
] as const

const CHROME_FONT_OPTIONS = [
  { id: 'inherit', label: '跟随正文' },
  ...TEXT_FONT_OPTIONS,
] as const

const CHROME_FONT_SIZE_OPTIONS = [8, 9, 10, 11, 12, 14] as const

export const paperFieldClass =
  'mt-1.5 h-9 w-full rounded-xl border border-black/10 bg-white/90 px-3 text-xs font-medium text-zinc-900 shadow-2xs outline-none transition-all focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-white/12 dark:bg-zinc-900/90 dark:text-zinc-100 dark:focus:border-zinc-100 dark:focus:ring-zinc-100'

export function FontSelect(props: {
  label: string
  ariaLabel: string
  value: string
  options: Array<{ id: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <label className="block text-xs font-semibold text-zinc-900 dark:text-zinc-100">
      {props.label}
      <select
        aria-label={props.ariaLabel}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className={paperFieldClass}
      >
        {props.options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function ChromeSettingsPanel(props: {
  printLayout: PrintLayoutSpec
  activeSlot: { section: PrintChromeSection; slot: PrintChromeSlotPosition } | null
  onPrintOptionChange: (patch: Partial<TeachingDocumentPrintOptions>) => void
  onSlotChange: (section: PrintChromeSection, slot: PrintChromeSlotPosition, patch: Partial<PrintChromeSlot>) => void
  onApplyTemplate: (template: PrintChromeTemplate) => void
}) {
  const sectionTitle: Record<PrintChromeSection, string> = { header: '页眉', footer: '页脚' }
  const [templates, setTemplates] = useState<PrintChromeTemplate[]>([])
  const [templateName, setTemplateName] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [templateBusy, setTemplateBusy] = useState(false)
  useEffect(() => {
    void teachingDocumentsApi.listPrintTemplates().then((response) => setTemplates(response.items)).catch(() => setTemplates([]))
  }, [])
  async function saveTemplate() {
    const options = {
      headerEnabled: props.printLayout.header.enabled,
      headerShowOnFirstPage: props.printLayout.header.showOnFirstPage,
      footerEnabled: props.printLayout.footer.enabled,
      header: props.printLayout.header.slots,
      footer: props.printLayout.footer.slots,
      pageNumber: props.printLayout.pageNumber,
    }
    const template = selectedTemplateId
      ? await teachingDocumentsApi.updatePrintTemplate(selectedTemplateId, { name: templateName, options })
      : await teachingDocumentsApi.createPrintTemplate({ name: templateName, options })
    setTemplates((current) => (selectedTemplateId ? current.map((item) => (item.id === template.id ? template : item)) : [template, ...current]))
    setSelectedTemplateId(template.id)
    setTemplateName(template.name)
  }
  async function removeTemplate() {
    if (!selectedTemplateId) return
    await teachingDocumentsApi.deletePrintTemplate(selectedTemplateId)
    setTemplates((current) => current.filter((item) => item.id !== selectedTemplateId))
    setSelectedTemplateId('')
    setTemplateName('')
  }
  function exportTemplates() {
    const payload = JSON.stringify({ version: 1, templates: templates.map(({ name, options }) => ({ name, options })) }, null, 2)
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
    const anchor = window.document.createElement('a')
    anchor.href = url
    anchor.download = '页眉页脚模板.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }
  async function importTemplates(file: File | undefined) {
    if (!file) return
    setTemplateBusy(true)
    try {
      const parsed = JSON.parse(await file.text()) as { templates?: Array<{ name?: unknown; options?: unknown }> }
      const incoming = Array.isArray(parsed.templates) ? parsed.templates : []
      const created: PrintChromeTemplate[] = []
      for (const item of incoming) {
        if (typeof item.name !== 'string' || !item.name.trim() || !item.options || typeof item.options !== 'object' || Array.isArray(item.options)) continue
        created.push(await teachingDocumentsApi.createPrintTemplate({ name: item.name, options: item.options as PrintChromeTemplate['options'] }))
      }
      setTemplates((current) => [...created, ...current])
    } catch {
      window.alert('模板文件无效，未能导入。')
    } finally {
      setTemplateBusy(false)
    }
  }
  return (
    <div className="space-y-5">
      {/* Checkbox Section */}
      <div className="question-edit-glass-preview grid grid-cols-2 gap-3 rounded-2xl border border-black/8 bg-white/80 p-4 dark:border-white/10 dark:bg-zinc-900/80">
        <label className="flex items-center gap-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
          <input
            type="checkbox"
            className="size-4 rounded border-black/10 dark:border-white/12"
            checked={props.printLayout.header.enabled}
            onChange={(event) => props.onPrintOptionChange({ headerEnabled: event.target.checked })}
          />
          显示页眉
        </label>
        <label className="flex items-center gap-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
          <input
            type="checkbox"
            className="size-4 rounded border-black/10 dark:border-white/12"
            checked={props.printLayout.header.showOnFirstPage}
            onChange={(event) => props.onPrintOptionChange({ headerShowOnFirstPage: event.target.checked })}
          />
          首页显示页眉
        </label>
        <label className="flex items-center gap-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
          <input
            type="checkbox"
            className="size-4 rounded border-black/10 dark:border-white/12"
            checked={props.printLayout.footer.enabled}
            onChange={(event) => props.onPrintOptionChange({ footerEnabled: event.target.checked })}
          />
          显示页脚
        </label>
      </div>

      {/* Templates Card */}
      <div className="question-edit-glass-preview rounded-2xl border border-black/8 bg-white/80 p-4 dark:border-white/10 dark:bg-zinc-900/80 space-y-3">
        <div className="flex items-center justify-between border-b border-black/6 pb-2 dark:border-white/8">
          <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">页眉页脚模板</p>
          <span className="text-[10px] font-medium text-zinc-400">本机复用</span>
        </div>
        <div className="flex gap-2">
          <select
            aria-label="选择页眉页脚模板"
            value={selectedTemplateId}
            onChange={(event) => {
              const id = event.target.value
              setSelectedTemplateId(id)
              const item = templates.find((template) => template.id === id)
              setTemplateName(item?.name || '')
            }}
            className="h-8.5 min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-2.5 text-xs font-medium text-zinc-900 shadow-2xs outline-none focus:border-zinc-900 dark:border-white/12 dark:bg-zinc-900 dark:text-zinc-100"
          >
            <option value="">选择预设模板…</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="h-8.5 rounded-xl border border-black/10 bg-white/90 px-3 text-xs font-semibold text-zinc-800 shadow-2xs transition-all hover:bg-white active:scale-95 disabled:opacity-30 dark:border-white/12 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            disabled={!selectedTemplateId}
            onClick={() => {
              const item = templates.find((template) => template.id === selectedTemplateId)
              if (item) props.onApplyTemplate(item)
            }}
          >
            应用
          </button>
          <button
            type="button"
            title="删除模板"
            className="h-8.5 rounded-xl border border-red-200 bg-red-50/60 px-3 text-xs font-semibold text-red-600 transition-all hover:bg-red-100 active:scale-95 disabled:opacity-30 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400"
            disabled={!selectedTemplateId}
            onClick={() => void removeTemplate()}
          >
            删除
          </button>
        </div>
        <div className="flex gap-2 pt-1">
          <input
            value={templateName}
            onChange={(event) => setTemplateName(event.target.value)}
            placeholder="自定义模板名称"
            className="h-8.5 min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3 text-xs font-medium text-zinc-900 shadow-2xs outline-none placeholder:text-zinc-400 focus:border-zinc-900 dark:border-white/12 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <button
            type="button"
            className="h-8.5 rounded-xl bg-zinc-900 px-3.5 text-xs font-semibold text-white shadow-2xs transition-all hover:bg-zinc-800 active:scale-95 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            onClick={() => void saveTemplate()}
          >
            {selectedTemplateId ? '更新模板' : '保存模板'}
          </button>
        </div>
        <div className="flex items-center gap-2 border-t border-black/6 pt-2.5 dark:border-white/8">
          <button
            type="button"
            title="导出模板包"
            className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-black/5 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-zinc-100"
            onClick={exportTemplates}
          >
            <Download className="size-3.5" />
            导出
          </button>
          <label
            title="导入模板包"
            className={`inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-black/5 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-zinc-100 ${
              templateBusy ? 'pointer-events-none opacity-40' : ''
            }`}
          >
            <FileUp className="size-3.5" />
            导入
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              disabled={templateBusy}
              onChange={(event) => {
                void importTemplates(event.target.files?.[0])
                event.currentTarget.value = ''
              }}
            />
          </label>
          <span className="ml-auto text-[10px] text-zinc-400">可在其他设备导入</span>
        </div>
      </div>

      {/* Header and Footer Slots Grid */}
      {(['header', 'footer'] as PrintChromeSection[]).map((section) => (
        <div key={section} className="space-y-2">
          <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{sectionTitle[section]}三栏内容设置</p>
          <div className="space-y-2.5">
            {(['left', 'center', 'right'] as PrintChromeSlotPosition[]).map((position) => {
              const slot = props.printLayout[section].slots[position]
              const active = props.activeSlot?.section === section && props.activeSlot.slot === position
              const positionLabel = { left: '左栏', center: '中栏', right: '右栏' }[position]
              return (
                <div
                  key={position}
                  className={`grid grid-cols-[38px_minmax(0,1fr)_80px] gap-2.5 rounded-2xl border p-3 transition-all ${
                    active
                      ? 'border-zinc-900 bg-white shadow-sm ring-1 ring-zinc-900 dark:border-zinc-100 dark:bg-zinc-900 dark:ring-zinc-100'
                      : 'border-black/6 bg-white/70 dark:border-white/8 dark:bg-zinc-900/70 shadow-2xs'
                  }`}
                >
                  <span className="self-center text-xs font-bold text-zinc-900 dark:text-zinc-100">{positionLabel}</span>
                  <div className="space-y-1.5 min-w-0">
                    <select
                      value={slot.type}
                      onChange={(event) => props.onSlotChange(section, position, { type: event.target.value as PrintChromeContentType })}
                      className="h-8 w-full rounded-xl border border-black/10 bg-white px-2.5 text-xs font-medium text-zinc-900 shadow-2xs outline-none dark:border-white/12 dark:bg-zinc-900 dark:text-zinc-100"
                    >
                      {CHROME_CONTENT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {slot.type === 'customText' ? (
                      <input
                        value={slot.text ?? ''}
                        onChange={(event) => props.onSlotChange(section, position, { text: event.target.value })}
                        placeholder="输入自定义内容"
                        className="h-8 w-full rounded-xl border border-black/10 bg-white px-2.5 text-xs font-medium text-zinc-900 shadow-2xs outline-none placeholder:text-zinc-400 dark:border-white/12 dark:bg-zinc-900 dark:text-zinc-100"
                      />
                    ) : null}
                    <div className="grid grid-cols-[minmax(0,1fr)_62px_auto_auto] gap-1.5">
                      <select
                        aria-label={`${sectionTitle[section]}${positionLabel}字体`}
                        value={slot.font ?? 'inherit'}
                        onChange={(event) => props.onSlotChange(section, position, { font: event.target.value as PrintChromeSlot['font'] })}
                        className="h-8 min-w-0 rounded-xl border border-black/10 bg-white px-2 text-xs text-zinc-900 shadow-2xs outline-none dark:border-white/12 dark:bg-zinc-900 dark:text-zinc-100"
                      >
                        {CHROME_FONT_OPTIONS.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label={`${sectionTitle[section]}${positionLabel}字号`}
                        value={slot.fontSize ?? 9}
                        onChange={(event) => props.onSlotChange(section, position, { fontSize: Number(event.target.value) as PrintChromeSlot['fontSize'] })}
                        className="h-8 rounded-xl border border-black/10 bg-white px-1.5 text-xs text-zinc-900 shadow-2xs outline-none dark:border-white/12 dark:bg-zinc-900 dark:text-zinc-100"
                      >
                        {CHROME_FONT_SIZE_OPTIONS.map((size) => (
                          <option key={size} value={size}>
                            {size}px
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        title="粗体"
                        aria-label={`${sectionTitle[section]}${positionLabel}粗体`}
                        aria-pressed={Boolean(slot.bold)}
                        onClick={() => props.onSlotChange(section, position, { bold: !slot.bold })}
                        className={`flex size-8 items-center justify-center rounded-xl border text-xs transition-all shadow-2xs ${
                          slot.bold
                            ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100'
                            : 'bg-white border-black/10 text-zinc-700 hover:bg-zinc-50 dark:bg-zinc-900 dark:border-white/12 dark:text-zinc-300'
                        }`}
                      >
                        <Bold className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        title="斜体"
                        aria-label={`${sectionTitle[section]}${positionLabel}斜体`}
                        aria-pressed={Boolean(slot.italic)}
                        onClick={() => props.onSlotChange(section, position, { italic: !slot.italic })}
                        className={`flex size-8 items-center justify-center rounded-xl border text-xs transition-all shadow-2xs ${
                          slot.italic
                            ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100'
                            : 'bg-white border-black/10 text-zinc-700 hover:bg-zinc-50 dark:bg-zinc-900 dark:border-white/12 dark:text-zinc-300'
                        }`}
                      >
                        <Italic className="size-3.5" />
                      </button>
                    </div>
                  </div>
                  <select
                    value={slot.align ?? position}
                    onChange={(event) => props.onSlotChange(section, position, { align: event.target.value as PrintChromeSlot['align'] })}
                    className="h-8 self-start rounded-xl border border-black/10 bg-white px-1.5 text-xs text-zinc-900 shadow-2xs outline-none dark:border-white/12 dark:bg-zinc-900 dark:text-zinc-100"
                  >
                    <option value="left">左对齐</option>
                    <option value="center">居中</option>
                    <option value="right">右对齐</option>
                  </select>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* Page Number Format Card */}
      <div className="question-edit-glass-preview rounded-2xl border border-black/8 bg-white/80 p-4 dark:border-white/10 dark:bg-zinc-900/80 space-y-3">
        <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">页码格式</p>
        <div className="grid grid-cols-2 gap-3">
          <select
            value={props.printLayout.pageNumber.format}
            onChange={(event) =>
              props.onPrintOptionChange({
                pageNumber: { ...props.printLayout.pageNumber, format: event.target.value as typeof props.printLayout.pageNumber.format },
              })
            }
            className="h-8.5 rounded-xl border border-black/10 bg-white px-2.5 text-xs font-medium text-zinc-900 shadow-2xs outline-none dark:border-white/12 dark:bg-zinc-900 dark:text-zinc-100"
          >
            {PAGE_NUMBER_FORMAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            <input
              type="checkbox"
              className="size-4 rounded border-black/10 dark:border-white/12"
              checked={props.printLayout.pageNumber.showTotalPages}
              onChange={(event) => props.onPrintOptionChange({ pageNumber: { ...props.printLayout.pageNumber, showTotalPages: event.target.checked } })}
            />
            显示总页数
          </label>
          <input
            value={props.printLayout.pageNumber.prefix}
            onChange={(event) => props.onPrintOptionChange({ pageNumber: { ...props.printLayout.pageNumber, prefix: event.target.value } })}
            placeholder="页码前缀"
            className="h-8.5 rounded-xl border border-black/10 bg-white px-3 text-xs font-medium text-zinc-900 shadow-2xs outline-none placeholder:text-zinc-400 dark:border-white/12 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <input
            value={props.printLayout.pageNumber.suffix}
            onChange={(event) => props.onPrintOptionChange({ pageNumber: { ...props.printLayout.pageNumber, suffix: event.target.value } })}
            placeholder="页码后缀"
            className="h-8.5 rounded-xl border border-black/10 bg-white px-3 text-xs font-medium text-zinc-900 shadow-2xs outline-none placeholder:text-zinc-400 dark:border-white/12 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>
      </div>
    </div>
  )
}
