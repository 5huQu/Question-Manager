import {
  Upload,
  LoaderCircle,
  FileText,
  FileCheck2,
  Trash2,
  Layers,
  FileArchive,
} from 'lucide-react'
import { Button, Panel } from '@/components/ui'
import type { ImportUploadState } from './useImportUpload'

interface FileUploadPanelProps {
  state: ImportUploadState
}

export function FileUploadPanel({ state }: FileUploadPanelProps) {
  const {
    uploadDocumentMode,
    setUploadDocumentMode,
    // single document
    pendingUploadFile,
    setPendingUploadFile,
    fileInputRef,
    dragOver,
    setDragOver,
    handleUploadFileSelection,
    // doc2x package
    doc2xPackageDocumentMode,
    setDoc2xPackageDocumentMode,
    doc2xPackageFile,
    setDoc2xPackageFile,
    doc2xSolutionPackageFile,
    setDoc2xSolutionPackageFile,
    selectedDoc2xParserPresetId,
    setSelectedDoc2xParserPresetId,
    doc2xPackageInputRef,
    doc2xSolutionPackageInputRef,
    handleDoc2xPackageSelection,
    parserPresets,
    // separated documents
    questionUploadFile,
    setQuestionUploadFile,
    solutionUploadFile,
    setSolutionUploadFile,
    questionFileInputRef,
    solutionFileInputRef,
    handleSeparatedFileSelection,
    // ocr & submit
    autoOcr,
    setAutoOcr,
    uploading,
    handleSubmit,
    currentOcrProviderLabel,
  } = state

  return (
    <div className="md:col-span-6 space-y-6">
      <Panel title="导入模式与文件上传">
        <div className="space-y-4">
          <div className="flex bg-black/4 dark:bg-white/6 p-1 rounded-xl border border-black/5 dark:border-white/8 w-full select-none">
            <button
              type="button"
              onClick={() => setUploadDocumentMode('single_document')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs transition-all cursor-pointer ${
                uploadDocumentMode === 'single_document'
                  ? 'bg-zinc-900 text-white shadow-2xs font-semibold dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 font-medium'
              }`}
            >
              <FileText className="size-3.5" />
              单文档导入
            </button>
            <button
              type="button"
              onClick={() => setUploadDocumentMode('separated_documents')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs transition-all cursor-pointer ${
                uploadDocumentMode === 'separated_documents'
                  ? 'bg-zinc-900 text-white shadow-2xs font-semibold dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 font-medium'
              }`}
            >
              <Layers className="size-3.5" />
              双文档导入（题解分离）
            </button>
            <button
              type="button"
              onClick={() => setUploadDocumentMode('doc2x_package')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs transition-all cursor-pointer ${
                uploadDocumentMode === 'doc2x_package'
                  ? 'bg-zinc-900 text-white shadow-2xs font-semibold dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 font-medium'
              }`}
            >
              <FileArchive className="size-3.5" />
              Doc2X 导出包
            </button>
          </div>

          {uploadDocumentMode === 'single_document' ? (
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                if (e.dataTransfer.files) {
                  handleUploadFileSelection(e.dataTransfer.files)
                }
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center min-h-[220px] shadow-2xs ${
                dragOver
                  ? 'border-zinc-900 bg-zinc-100/60 dark:border-zinc-100 dark:bg-zinc-800/60'
                  : 'border-black/10 bg-white/80 hover:bg-white hover:border-black/20 dark:border-white/12 dark:bg-zinc-900/80 dark:hover:bg-zinc-900'
              }`}
            >
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="application/json,.json,application/pdf,.pdf,image/png,image/jpeg,image/jpg"
                onChange={(e) => {
                  if (e.target.files) handleUploadFileSelection(e.target.files)
                }}
              />
              {uploading ? (
                <LoaderCircle className="size-8 animate-spin text-zinc-600 dark:text-zinc-300 mb-3" />
              ) : (
                <div className="flex size-12 items-center justify-center rounded-2xl bg-black/4 text-zinc-600 dark:bg-white/6 dark:text-zinc-300 mb-3">
                  <Upload className="size-6" />
                </div>
              )}
              <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                {uploading ? '文件上传并处理中...' : pendingUploadFile ? pendingUploadFile.name : '点击选择或拖拽资料至此处'}
              </p>
              <p className="text-[11px] text-zinc-400 mt-1">
                {pendingUploadFile ? '已选择文件，提交后直接开始导入' : '支持 PDF、PNG/JPG 或本地 OCRDocument JSON'}
              </p>
              {pendingUploadFile && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setPendingUploadFile(null)
                  }}
                  className="mt-3 text-xs text-rose-600 hover:underline flex items-center gap-1 font-medium"
                >
                  <Trash2 className="size-3" /> 移除文件
                </button>
              )}
            </div>
          ) : uploadDocumentMode === 'doc2x_package' ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">文档路径</div>
                <div className="flex bg-black/4 dark:bg-white/6 p-1 rounded-xl border border-black/5 dark:border-white/8 w-full select-none">
                  {([
                    ['single_document', '单文档（题干答案混排）'],
                    ['separated_documents', '双文档（题目 + 解析）'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setDoc2xPackageDocumentMode(value)}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        doc2xPackageDocumentMode === value
                          ? 'bg-zinc-900 text-white shadow-2xs dark:bg-zinc-100 dark:text-zinc-900'
                          : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">解析方式</span>
                <select
                  value={selectedDoc2xParserPresetId}
                  onChange={(event) => setSelectedDoc2xParserPresetId(event.target.value)}
                  disabled={parserPresets.loading}
                  className="h-9.5 w-full cursor-pointer rounded-xl border border-black/10 bg-white/90 px-3 text-xs font-medium text-zinc-900 shadow-2xs outline-none transition-all focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 disabled:cursor-wait disabled:text-zinc-400 dark:border-white/12 dark:bg-zinc-900/90 dark:text-zinc-100 dark:focus:border-zinc-100"
                >
                  <option value="">{parserPresets.loading ? '正在加载解析方式...' : '请选择解析方式'}</option>
                  {(parserPresets.data?.items || []).map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
                {selectedDoc2xParserPresetId && (
                  <span className="block text-[11px] text-zinc-400 leading-normal">
                    {(parserPresets.data?.items || []).find((preset) => preset.id === selectedDoc2xParserPresetId)?.description}
                  </span>
                )}
                {parserPresets.error && <span className="block text-[11px] text-rose-500">解析方式加载失败：{parserPresets.error}</span>}
              </label>

              <input
                type="file"
                ref={doc2xPackageInputRef}
                className="hidden"
                accept="application/zip,.zip"
                onChange={(e) => handleDoc2xPackageSelection('full_or_questions', e.target.files)}
              />
              {doc2xPackageFile ? (
                <div className="rounded-2xl border border-black/10 bg-white/90 p-3.5 dark:border-white/12 dark:bg-zinc-900/90 shadow-2xs flex items-center justify-between gap-3 transition-all">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-black/5 text-zinc-800 dark:bg-white/8 dark:text-zinc-200 shrink-0">
                      <FileCheck2 className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                          {doc2xPackageDocumentMode === 'single_document' ? 'Doc2X 完整包' : '题目 Doc2X 包'}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-black/5 text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
                          已就绪
                        </span>
                      </div>
                      <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 truncate mt-0.5" title={doc2xPackageFile.name}>
                        {doc2xPackageFile.name}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDoc2xPackageFile(null)
                      if (doc2xPackageInputRef.current) doc2xPackageInputRef.current.value = ''
                    }}
                    className="size-8 rounded-lg text-zinc-400 hover:bg-black/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-zinc-100 flex items-center justify-center transition-all shrink-0 cursor-pointer active:scale-95"
                    title="移除此 ZIP 包"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => doc2xPackageInputRef.current?.click()}
                  className="flex min-h-[110px] w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-black/10 bg-white/70 p-5 text-center transition-all hover:border-black/20 hover:bg-white dark:border-white/12 dark:bg-zinc-900/70 dark:hover:bg-zinc-900 shadow-2xs group cursor-pointer"
                >
                  <div className="flex size-10 items-center justify-center rounded-xl bg-black/4 text-zinc-500 group-hover:scale-105 transition-transform dark:bg-white/6 dark:text-zinc-400 mb-2">
                    <FileArchive className="size-5" />
                  </div>
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                    {doc2xPackageDocumentMode === 'single_document'
                      ? '选择包含题干、答案和解析的 Doc2X ZIP'
                      : '选择题目 Doc2X ZIP'}
                  </span>
                  <span className="mt-1 text-[11px] text-zinc-400">导入现成识别结果，不会调用或消耗 OCR 模型</span>
                </button>
              )}

              {doc2xPackageDocumentMode === 'separated_documents' && (
                <>
                  <input
                    type="file"
                    ref={doc2xSolutionPackageInputRef}
                    className="hidden"
                    accept="application/zip,.zip"
                    onChange={(e) => handleDoc2xPackageSelection('solutions', e.target.files)}
                  />
                  {doc2xSolutionPackageFile ? (
                    <div className="rounded-2xl border border-black/10 bg-white/90 p-3.5 dark:border-white/12 dark:bg-zinc-900/90 shadow-2xs flex items-center justify-between gap-3 transition-all">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="flex size-10 items-center justify-center rounded-xl bg-black/5 text-zinc-800 dark:bg-white/8 dark:text-zinc-200 shrink-0">
                          <FileCheck2 className="size-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">答案解析 Doc2X 包</span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-black/5 text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
                              已就绪
                            </span>
                          </div>
                          <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 truncate mt-0.5" title={doc2xSolutionPackageFile.name}>
                            {doc2xSolutionPackageFile.name}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setDoc2xSolutionPackageFile(null)
                          if (doc2xSolutionPackageInputRef.current) doc2xSolutionPackageInputRef.current.value = ''
                        }}
                        className="size-8 rounded-lg text-zinc-400 hover:bg-black/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-zinc-100 flex items-center justify-center transition-all shrink-0 cursor-pointer active:scale-95"
                        title="移除此 ZIP 包"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => doc2xSolutionPackageInputRef.current?.click()}
                      className="flex min-h-[90px] w-full items-center gap-3.5 rounded-2xl border-2 border-dashed border-black/10 bg-white/70 p-4 text-left transition-all hover:border-black/20 hover:bg-white dark:border-white/12 dark:bg-zinc-900/70 dark:hover:bg-zinc-900 shadow-2xs group cursor-pointer"
                    >
                      <div className="flex size-10 items-center justify-center rounded-xl bg-black/4 text-zinc-500 group-hover:scale-105 transition-transform dark:bg-white/6 dark:text-zinc-400 shrink-0">
                        <FileCheck2 className="size-5" />
                      </div>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-zinc-900 dark:text-zinc-50">选择答案解析 Doc2X ZIP</span>
                        <span className="mt-0.5 block text-[11px] text-zinc-400">与上方题目包按题号自动合并</span>
                      </span>
                    </button>
                  )}
                </>
              )}

              <div className="rounded-2xl border border-black/8 bg-black/3 dark:border-white/10 dark:bg-white/4 p-4 text-[11px] leading-5 text-zinc-700 dark:text-zinc-300 shadow-2xs space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-xs text-zinc-900 dark:text-zinc-100">
                  <FileArchive className="size-3.5 text-zinc-600 dark:text-zinc-400" />
                  Doc2X 推荐导出设置
                </div>
                <div className="font-semibold text-zinc-800 dark:text-zinc-200">
                  导出 Markdown · 公式符 $...$ · 不退化公式 · 本地图片
                </div>
                <div className="text-zinc-500 dark:text-zinc-400">
                  ZIP 包内应包含 1 个 .md 文件及 images 图片目录；导入后会自动清理 Meanless 注释、归一化图片并生成候选题。
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <input
                type="file"
                ref={questionFileInputRef}
                className="hidden"
                accept="application/pdf,.pdf,image/png,image/jpeg,image/jpg"
                onChange={(e) => handleSeparatedFileSelection('questions', e.target.files)}
              />
              <input
                type="file"
                ref={solutionFileInputRef}
                className="hidden"
                accept="application/pdf,.pdf,image/png,image/jpeg,image/jpg"
                onChange={(e) => handleSeparatedFileSelection('solutions', e.target.files)}
              />

              {questionUploadFile ? (
                <div className="rounded-2xl border border-black/10 bg-white/90 p-3.5 dark:border-white/12 dark:bg-zinc-900/90 shadow-2xs flex items-center justify-between gap-3 transition-all">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-black/5 text-zinc-800 dark:bg-white/8 dark:text-zinc-200 shrink-0">
                      <FileText className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">原卷文件</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-black/5 text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
                          已就绪
                        </span>
                      </div>
                      <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 truncate mt-0.5" title={questionUploadFile.name}>
                        {questionUploadFile.name}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setQuestionUploadFile(null)
                      if (questionFileInputRef.current) questionFileInputRef.current.value = ''
                    }}
                    className="size-8 rounded-lg text-zinc-400 hover:bg-black/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-zinc-100 flex items-center justify-center transition-all shrink-0 cursor-pointer active:scale-95"
                    title="清除原卷文件"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => questionFileInputRef.current?.click()}
                  className="flex w-full items-center gap-3.5 rounded-2xl border-2 border-dashed border-black/10 bg-white/70 p-4 text-left transition-all hover:border-black/20 hover:bg-white dark:border-white/12 dark:bg-zinc-900/70 dark:hover:bg-zinc-900 shadow-2xs group cursor-pointer"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-black/4 text-zinc-500 group-hover:scale-105 transition-transform dark:bg-white/6 dark:text-zinc-400">
                    <FileText className="size-5" />
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-zinc-900 dark:text-zinc-50">原卷文件</span>
                    <span className="block truncate text-[11px] text-zinc-400">选择题干文档、学生版或原卷 PDF/图片</span>
                  </span>
                </button>
              )}

              {solutionUploadFile ? (
                <div className="rounded-2xl border border-black/10 bg-white/90 p-3.5 dark:border-white/12 dark:bg-zinc-900/90 shadow-2xs flex items-center justify-between gap-3 transition-all">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-black/5 text-zinc-800 dark:bg-white/8 dark:text-zinc-200 shrink-0">
                      <FileCheck2 className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">答案解析文件</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-black/5 text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
                          已就绪
                        </span>
                      </div>
                      <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 truncate mt-0.5" title={solutionUploadFile.name}>
                        {solutionUploadFile.name}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSolutionUploadFile(null)
                      if (solutionFileInputRef.current) solutionFileInputRef.current.value = ''
                    }}
                    className="size-8 rounded-lg text-zinc-400 hover:bg-black/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-zinc-100 flex items-center justify-center transition-all shrink-0 cursor-pointer active:scale-95"
                    title="清除答案解析文件"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => solutionFileInputRef.current?.click()}
                  className="flex w-full items-center gap-3.5 rounded-2xl border-2 border-dashed border-black/10 bg-white/70 p-4 text-left transition-all hover:border-black/20 hover:bg-white dark:border-white/12 dark:bg-zinc-900/70 dark:hover:bg-zinc-900 shadow-2xs group cursor-pointer"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-black/4 text-zinc-500 group-hover:scale-105 transition-transform dark:bg-white/6 dark:text-zinc-400">
                    <FileCheck2 className="size-5" />
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-zinc-900 dark:text-zinc-50">答案解析文件</span>
                    <span className="block truncate text-[11px] text-zinc-400">选择答案、详解或教师版 PDF/图片</span>
                  </span>
                </button>
              )}
            </div>
          )}

          {/* 自动 OCR 选项 */}
          {uploadDocumentMode !== 'doc2x_package' && (
            <div className="rounded-xl border border-black/8 bg-white/60 p-3.5 flex items-center justify-between dark:border-white/10 dark:bg-zinc-900/60 shadow-2xs">
              <div className="space-y-0.5">
                <span className="block text-xs font-semibold text-zinc-900 dark:text-zinc-50">自动启动 OCR 识别</span>
                <span className="block text-[11px] text-zinc-400">提交文件后立即通过 {currentOcrProviderLabel} 开始自动排队处理</span>
              </div>
              <input
                type="checkbox"
                className="size-4 rounded border-black/10 text-zinc-900 focus:ring-zinc-900 dark:border-white/12 cursor-pointer"
                checked={autoOcr}
                onChange={(e) => setAutoOcr(e.target.checked)}
              />
            </div>
          )}

          <div className="pt-2 flex justify-end">
            <Button
              size="default"
              disabled={
                uploading ||
                (uploadDocumentMode === 'single_document'
                  ? !pendingUploadFile
                  : uploadDocumentMode === 'doc2x_package'
                    ? !selectedDoc2xParserPresetId || !doc2xPackageFile || (doc2xPackageDocumentMode === 'separated_documents' && !doc2xSolutionPackageFile)
                    : !questionUploadFile || !solutionUploadFile)
              }
              onClick={handleSubmit}
              className="w-full sm:w-auto px-6 py-2.5 rounded-xl font-semibold text-xs shadow-xs transition-all active:scale-[0.98] bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {uploading ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  正在提交...
                </>
              ) : (
                '提交导入'
              )}
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  )
}
