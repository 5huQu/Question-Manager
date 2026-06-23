import { useState } from 'react'
import {
  Wrench,
  RefreshCw,
  Scissors,
  Plus,
  Trash2,
  CheckCircle2,
  Save,
  Play,
  ToggleLeft,
  ToggleRight,
  HelpCircle,
  ExternalLink,
  Cpu,
  Check,
  AlertTriangle,
  Layers,
  FileText,
  SlidersHorizontal
} from 'lucide-react'

type SlicerRuleCategory =
  | 'auxiliaryMarkers'
  | 'noticeTerms'
  | 'referenceFormulaMarkers'
  | 'trainingMarkers'
  | 'nonQuestionRemainders'
  | 'sectionMarkers'

interface SlicerRule {
  id: string
  term: string
  mode: 'contains' | 'exact'
  enabled: boolean
}

export default function MockSettingsPage() {
  const [showSaveToast, setShowSaveToast] = useState(false)
  const [saveToastMsg, setSaveToastMsg] = useState('')

  // 1. 基础设置 States
  const [systemName, setSystemName] = useState('Question Manager')
  const [webTitle, setWebTitle] = useState('Question Manager')
  const [webDesc, setWebDesc] = useState('本地优先的 PDF 切分、OCR 识别与数学题库工作台。')
  const [exportTemplateMode, setExportTemplateMode] = useState<'builtin' | 'examch'>('builtin')
  const [stages, setStages] = useState({
    primary: false,
    junior: false,
    senior: true,
    other: false
  })
  const [watermarks, setWatermarks] = useState({
    worksheet: '教师姓名 · 工作室',
    exam: 'Question Manager',
    lecture: '教师姓名 · 工作室'
  })

  // 2. 外部工具 States
  const [sofficePath, setSofficePath] = useState('C:\\Program Files\\LibreOffice\\program\\soffice.exe')
  const [sofficeDetectedPath] = useState('/Applications/LibreOffice.app/Contents/MacOS/soffice')
  const [sofficeAvailable] = useState(true)

  // 3. OCR 接口设置 States
  const [ocrProvider, setOcrProvider] = useState<'doc2x' | 'glm'>('glm')
  const [doc2xApiUrl, setDoc2xApiUrl] = useState('https://v2.doc2x.noedgeai.com')
  const [doc2xApiKey, setDoc2xApiKey] = useState('doc2x_sk_xxxxxxxxxxxxxxxxxxxxxx')
  const [doc2xModel, setDoc2xModel] = useState('v3-2026')

  const [glmApiUrl, setGlmApiUrl] = useState('https://open.bigmodel.cn/api/paas/v4/layout_parsing')
  const [glmApiKey, setGlmApiKey] = useState('glm_sk_xxxxxxxxxxxxxxxxxxxxxxxxxx')
  const [glmModel, setGlmModel] = useState('glm-ocr')
  
  const [ocrConfidence, setOcrConfidence] = useState('0.85')
  const [ocrTesting, setOcrTesting] = useState(false)
  const [ocrTestResult, setOcrTestResult] = useState<'idle' | 'success'>('idle')

  // 4. 数据分类/自动标签 States
  const [classificationEnabled, setClassificationEnabled] = useState(true)
  const [cleanupApiUrl, setCleanupApiUrl] = useState('')
  const [cleanupApiKey, setCleanupApiKey] = useState('')
  const [cleanupModel, setCleanupModel] = useState('glm-4-flash')
  const [cleanupConcurrency, setCleanupConcurrency] = useState('5')
  const [classSystemPrompt, setClassSystemPrompt] = useState(
    '你是一个专业的试题属性分类专家。根据提供的题目内容，提取出包含的知识点、解题方法和难度级别（容易、中等、较难）。以 JSON 格式输出。'
  )
  const [classUserPrompt, setClassUserPrompt] = useState(
    '请对以下试题内容进行属性提取：\n{payload}'
  )

  // 5. 系统提示词 States
  const [wholeSystemPrompt, setWholeSystemPrompt] = useState('')
  const [wholeUserPrompt, setWholeUserPrompt] = useState('')
  const [chunkSystemPrompt, setChunkSystemPrompt] = useState('')
  const [chunkUserPrompt, setChunkUserPrompt] = useState('')

  // 6. 切题规则 States (6 Categories)
  const [activeRuleCat, setActiveRuleCat] = useState<SlicerRuleCategory>('auxiliaryMarkers')
  const [rules, setRules] = useState<Record<SlicerRuleCategory, SlicerRule[]>>({
    auxiliaryMarkers: [
      { id: 'am1', term: '目录', mode: 'contains', enabled: true },
      { id: 'am2', term: '解题规律', mode: 'contains', enabled: true },
      { id: 'am3', term: '提分快招', mode: 'contains', enabled: true },
      { id: 'am4', term: '题型归纳', mode: 'contains', enabled: true },
      { id: 'am5', term: '题型探析', mode: 'contains', enabled: true },
      { id: 'am6', term: '思维导图', mode: 'contains', enabled: true }
    ],
    noticeTerms: [
      { id: 'nt1', term: '答题', mode: 'contains', enabled: true },
      { id: 'nt2', term: '注意事项', mode: 'contains', enabled: true },
      { id: 'nt3', term: '作答', mode: 'contains', enabled: true },
      { id: 'nt4', term: '考试结束', mode: 'contains', enabled: true },
      { id: 'nt5', term: '答卷前', mode: 'contains', enabled: true },
      { id: 'nt6', term: '答案不能答在试卷上', mode: 'contains', enabled: true }
    ],
    referenceFormulaMarkers: [
      { id: 'rf1', term: '参考公式', mode: 'contains', enabled: true },
      { id: 'rf2', term: '附录', mode: 'contains', enabled: true },
      { id: 'rf3', term: '常用数据', mode: 'contains', enabled: true }
    ],
    trainingMarkers: [
      { id: 'tm1', term: '随堂训练', mode: 'contains', enabled: true },
      { id: 'tm2', term: '课后练习', mode: 'contains', enabled: true },
      { id: 'tm3', term: '拓展提高', mode: 'contains', enabled: true }
    ],
    nonQuestionRemainders: [
      { id: 'nq1', term: '本卷结束', mode: 'contains', enabled: true },
      { id: 'nq2', term: '祝考试顺利', mode: 'contains', enabled: true },
      { id: 'nq3', term: '试卷第', mode: 'contains', enabled: true }
    ],
    sectionMarkers: [
      { id: 'sm1', term: '第一部分', mode: 'contains', enabled: true },
      { id: 'sm2', term: '第二部分', mode: 'contains', enabled: true },
      { id: 'sm3', term: '基础题', mode: 'contains', enabled: true },
      { id: 'sm4', term: '拔高题', mode: 'contains', enabled: true }
    ]
  })

  const [currentVersion] = useState('v2.0.0')
  const [latestVersion] = useState('v2.1.0')

  const triggerSave = (moduleName: string) => {
    setSaveToastMsg(`「${moduleName}」配置已成功保存！`)
    setShowSaveToast(true)
    setTimeout(() => {
      setShowSaveToast(false)
    }, 2500)
  }

  const handleOcrTest = () => {
    setOcrTesting(true)
    setTimeout(() => {
      setOcrTesting(false)
      setOcrTestResult('success')
      setTimeout(() => setOcrTestResult('idle'), 3000)
    }, 1200)
  }

  // Slicer Rule helper methods
  const addRuleRow = () => {
    const newRule: SlicerRule = {
      id: Math.random().toString(),
      term: '',
      mode: 'contains',
      enabled: true
    }
    setRules({
      ...rules,
      [activeRuleCat]: [...rules[activeRuleCat], newRule]
    })
  }

  const deleteRuleRow = (id: string) => {
    setRules({
      ...rules,
      [activeRuleCat]: rules[activeRuleCat].filter(r => r.id !== id)
    })
  }

  const updateRuleRow = (id: string, key: keyof SlicerRule, val: any) => {
    setRules({
      ...rules,
      [activeRuleCat]: rules[activeRuleCat].map(r => r.id === id ? { ...r, [key]: val } : r)
    })
  }

  const toggleRuleEnabled = (id: string) => {
    setRules({
      ...rules,
      [activeRuleCat]: rules[activeRuleCat].map(r => r.id === id ? { ...r, enabled: !r.enabled } : r)
    })
  }

  const ruleCategoriesList = [
    { key: 'auxiliaryMarkers', label: '辅助标记', desc: '跳过辅助页面检测' },
    { key: 'noticeTerms', label: '注意事项', desc: '避免注意事项误判为题号' },
    { key: 'referenceFormulaMarkers', label: '参考公式', desc: '在参考公式附近抑制题号' },
    { key: 'trainingMarkers', label: '训练标记', desc: '不作为边界的训练区标题' },
    { key: 'nonQuestionRemainders', label: '非题剩余文字', desc: '末尾文字不当作题号' },
    { key: 'sectionMarkers', label: '章节标记', desc: '识别非标准题型作为分割线' }
  ] as const

  return (
    <div className="mock-page-root flex flex-col gap-6 p-6 min-h-[calc(100vh-6rem)] overflow-y-auto bg-zinc-50/10 dark:bg-zinc-950/20 text-zinc-950 dark:text-zinc-50 select-none">
      
      {/* Page Header */}
      <div className="flex flex-col gap-1 border-b border-zinc-200 dark:border-zinc-800 pb-4 text-left">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">系统设置</h1>
        <p className="text-[13px] text-zinc-500 dark:text-zinc-400">配置系统的基础名称、外部转换工具、OCR 识别引擎密钥、大模型分类参数以及 PDF 切题匹配词字典。</p>
      </div>

      {/* Grid Layout: 2 Columns left for edit settings, 1 Column right for status and updates */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start text-left">
        
        {/* Left Columns (lg:col-span-2) */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Card 1: 基础设置 */}
          <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950 overflow-hidden">
            <div className="p-5 border-b border-zinc-150 dark:border-zinc-850 bg-zinc-50/50 dark:bg-zinc-900/10">
              <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">基础设置</h3>
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-1">控制左上角系统名称、网页标题描述，以及几套 TeX 模板导出时使用的水印/品牌文字。</p>
            </div>
            
            <div className="p-5 space-y-5">
              
              {/* 网站与系统名称 */}
              <div className="space-y-4">
                <span className="text-xs font-bold text-zinc-450 uppercase tracking-wider block border-b border-zinc-100 pb-1.5 dark:border-zinc-900">网站与系统名称</span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-zinc-500 block">左上角系统名称</label>
                    <input
                      type="text"
                      value={systemName}
                      onChange={(e) => setSystemName(e.target.value)}
                      className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-950 dark:focus:border-zinc-300"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-zinc-500 block">系统网站标题</label>
                    <input
                      type="text"
                      value={webTitle}
                      onChange={(e) => setWebTitle(e.target.value)}
                      className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-950 dark:focus:border-zinc-300"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium text-zinc-500 block">系统网站描述</label>
                  <textarea
                    rows={2}
                    value={webDesc}
                    onChange={(e) => setWebDesc(e.target.value)}
                    className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-950 dark:focus:border-zinc-300"
                  />
                </div>
              </div>

              {/* 导出选项与教学学段 */}
              <div className="space-y-4 pt-2 border-t border-zinc-100 dark:border-zinc-900">
                <span className="text-xs font-bold text-zinc-450 uppercase tracking-wider block border-b border-zinc-100 pb-1.5 dark:border-zinc-900">导出选项与教学学段</span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-zinc-500 block">试卷导出模板</label>
                    <div className="flex gap-2 max-w-xs">
                      <button
                        type="button"
                        onClick={() => setExportTemplateMode('builtin')}
                        className={`flex-1 rounded border px-3 py-1.5 text-xs font-semibold transition-all ${
                          exportTemplateMode === 'builtin'
                            ? 'border-zinc-900 bg-zinc-950 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950 shadow-sm'
                            : 'border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900'
                        }`}
                      >
                        自带模板
                      </button>
                      <button
                        type="button"
                        onClick={() => setExportTemplateMode('examch')}
                        className={`flex-1 rounded border px-3 py-1.5 text-xs font-semibold transition-all ${
                          exportTemplateMode === 'examch'
                            ? 'border-zinc-900 bg-zinc-950 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950 shadow-sm'
                            : 'border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900'
                        }`}
                      >
                        Examch
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-zinc-500 block">教学学段</label>
                    <div className="flex gap-2 flex-wrap">
                      {[
                        { key: 'primary', label: '小学' },
                        { key: 'junior', label: '初中' },
                        { key: 'senior', label: '高中' },
                        { key: 'other', label: '其他' }
                      ].map((item) => (
                        <label
                          key={item.key}
                          className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-semibold cursor-pointer transition-all ${
                            (stages as any)[item.key]
                              ? 'border-zinc-900 bg-zinc-950 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950 shadow-sm'
                              : 'border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="hidden"
                            checked={(stages as any)[item.key]}
                            onChange={(e) => setStages({ ...stages, [item.key]: e.target.checked })}
                          />
                          <span className={`inline-block size-3 rounded-sm border flex items-center justify-center ${
                            (stages as any)[item.key] ? 'border-white bg-transparent dark:border-zinc-950' : 'border-zinc-350'
                          }`}>
                            {(stages as any)[item.key] && <span className="size-1 bg-white rounded-sm dark:bg-zinc-950" />}
                          </span>
                          {item.label}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500 leading-normal">
                  新增资料和题目时会按这里展开年级：小学为一年级至六年级，勾选其他会额外显示“其他”。
                </p>
              </div>

              {/* 模板水印文字 */}
              <div className="space-y-4 pt-2 border-t border-zinc-100 dark:border-zinc-900">
                <span className="text-xs font-bold text-zinc-450 uppercase tracking-wider block border-b border-zinc-100 pb-1.5 dark:border-zinc-900">模板水印文字</span>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-zinc-500 block">练习单模板水印</label>
                    <input
                      type="text"
                      value={watermarks.worksheet}
                      onChange={(e) => setWatermarks({ ...watermarks, worksheet: e.target.value })}
                      className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-950 dark:focus:border-zinc-300"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-zinc-500 block">试卷模板水印</label>
                    <input
                      type="text"
                      value={watermarks.exam}
                      onChange={(e) => setWatermarks({ ...watermarks, exam: e.target.value })}
                      className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-950 dark:focus:border-zinc-300"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-zinc-500 block">讲义模板水印</label>
                    <input
                      type="text"
                      value={watermarks.lecture}
                      onChange={(e) => setWatermarks({ ...watermarks, lecture: e.target.value })}
                      className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-950 dark:focus:border-zinc-300"
                    />
                  </div>
                </div>
              </div>

            </div>

            <div className="px-5 py-3 border-t border-zinc-150 dark:border-zinc-850 bg-zinc-50/50 dark:bg-zinc-900/10 flex justify-end">
              <button
                onClick={() => triggerSave('基础设置')}
                className="inline-flex items-center gap-1.5 rounded bg-zinc-950 hover:bg-zinc-855 text-zinc-50 text-xs font-semibold px-3 py-1.5 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 transition-colors cursor-pointer"
              >
                <Save className="size-3.5" />
                保存基础设置
              </button>
            </div>
          </div>

          {/* Card 2: 外部集成工具 */}
          <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950 overflow-hidden">
            <div className="p-5 border-b border-zinc-150 dark:border-zinc-850 bg-zinc-50/50 dark:bg-zinc-900/10">
              <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">外部集成工具</h3>
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-1">用于 DOC/DOCX 上传后的 Word 转 PDF。应用会自动查找默认安装目录，也可以手动指定 soffice.exe。</p>
            </div>

            <div className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-zinc-500 block">soffice.exe 路径</label>
                <input
                  type="text"
                  value={sofficePath}
                  onChange={(e) => setSofficePath(e.target.value)}
                  className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-950 dark:focus:border-zinc-300 font-mono"
                />
                <p className="text-[11px] text-zinc-450 dark:text-zinc-500 leading-normal">
                  默认安装通常无需填写。当前检测路径：{sofficeDetectedPath}
                </p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <span className="inline-flex h-8 items-center gap-1.5 rounded border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
                  <Check className="size-3.5" />
                  已检测到 LibreOffice 环境
                </span>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-zinc-150 dark:border-zinc-850 bg-zinc-50/50 dark:bg-zinc-900/10 flex justify-end">
              <button
                onClick={() => triggerSave('外部集成工具')}
                className="inline-flex items-center gap-1.5 rounded bg-zinc-950 hover:bg-zinc-855 text-zinc-50 text-xs font-semibold px-3 py-1.5 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 transition-colors cursor-pointer"
              >
                <Save className="size-3.5" />
                保存路径设置
              </button>
            </div>
          </div>

          {/* Card 3: OCR 接口配置 */}
          <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950 overflow-hidden">
            <div className="p-5 border-b border-zinc-150 dark:border-zinc-850 bg-zinc-50/50 dark:bg-zinc-900/10">
              <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">OCR 接口设置</h3>
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-1">配置默认的 OCR 解析提供方。支持 Doc2X 批量识别与 GLM-OCR 的版面及段落解析。</p>
            </div>

            <div className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-zinc-500 block">默认 OCR 提供方</label>
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-100 dark:bg-zinc-900 p-1">
                  <button
                    type="button"
                    onClick={() => setOcrProvider('doc2x')}
                    className={`h-8 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      ocrProvider === 'doc2x'
                        ? 'bg-white text-zinc-955 shadow-xs dark:bg-zinc-950 dark:text-zinc-50'
                        : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-350'
                    }`}
                  >
                    Doc2X API
                  </button>
                  <button
                    type="button"
                    onClick={() => setOcrProvider('glm')}
                    className={`h-8 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      ocrProvider === 'glm'
                        ? 'bg-white text-zinc-955 shadow-xs dark:bg-zinc-950 dark:text-zinc-50'
                        : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-350'
                    }`}
                  >
                    GLM-OCR
                  </button>
                </div>
              </div>

              {ocrProvider === 'doc2x' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-[13px] font-medium text-zinc-500 block">Doc2X API 地址</label>
                    <input
                      type="text"
                      value={doc2xApiUrl}
                      onChange={(e) => setDoc2xApiUrl(e.target.value)}
                      className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-950 dark:focus:border-zinc-300 font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-zinc-500 block">Doc2X API Key</label>
                    <input
                      type="password"
                      value={doc2xApiKey}
                      onChange={(e) => setDoc2xApiKey(e.target.value)}
                      className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-950 dark:focus:border-zinc-300 font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-zinc-500 block">Doc2X 模型</label>
                    <select
                      value={doc2xModel}
                      onChange={(e) => setDoc2xModel(e.target.value)}
                      className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none cursor-pointer focus:border-zinc-950 dark:focus:border-zinc-300"
                    >
                      <option value="v3-2026">v3-2026</option>
                      <option value="v2">v2</option>
                    </select>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-[13px] font-medium text-zinc-500 block">GLM-OCR API 地址</label>
                    <input
                      type="text"
                      value={glmApiUrl}
                      onChange={(e) => setGlmApiUrl(e.target.value)}
                      className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-950 dark:focus:border-zinc-300 font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-zinc-500 block">GLM-OCR API Key</label>
                    <input
                      type="password"
                      value={glmApiKey}
                      onChange={(e) => setGlmApiKey(e.target.value)}
                      className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-950 dark:focus:border-zinc-300 font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-zinc-500 block">模型</label>
                    <input
                      type="text"
                      value={glmModel}
                      onChange={(e) => setGlmModel(e.target.value)}
                      className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-950 dark:focus:border-zinc-300 font-mono"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2 border-t border-zinc-100 dark:border-zinc-800 pt-4">
                <div className="flex items-center justify-between">
                  <label className="text-[13px] font-medium text-zinc-500">置信度阈值过滤</label>
                  <span className="font-mono text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                    {Math.round(parseFloat(ocrConfidence) * 100)}%
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0.50"
                    max="0.99"
                    step="0.05"
                    value={ocrConfidence}
                    onChange={(e) => setOcrConfidence(e.target.value)}
                    className="w-full accent-zinc-900 dark:accent-zinc-100 h-1.5 bg-zinc-200 rounded-lg cursor-pointer dark:bg-zinc-800"
                  />
                </div>
                <p className="text-[11px] text-zinc-455 dark:text-zinc-500 leading-normal">
                  低于该置信度的识别结果将在【OCR 复核】页面以黄色警示框标记，方便二次校对。
                </p>
              </div>

              {/* Connection Test */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleOcrTest}
                  disabled={ocrTesting}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-zinc-200 bg-white hover:bg-zinc-50 text-xs font-semibold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 disabled:opacity-55 cursor-pointer"
                >
                  {ocrTesting ? <RefreshCw className="size-3 animate-spin" /> : <Play className="size-3" />}
                  {ocrTesting ? '连接中...' : '进行连接测试'}
                </button>
                {ocrTestResult === 'success' && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 animate-fade-in">
                    <Check className="size-3.5" /> 连接测试成功 (网络延迟 142ms)
                  </span>
                )}
              </div>
            </div>

            <div className="px-5 py-3 border-t border-zinc-150 dark:border-zinc-850 bg-zinc-50/50 dark:bg-zinc-900/10 flex justify-end">
              <button
                onClick={() => triggerSave('OCR 引擎')}
                className="inline-flex items-center gap-1.5 rounded bg-zinc-950 hover:bg-zinc-855 text-zinc-50 text-xs font-semibold px-3 py-1.5 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 transition-colors cursor-pointer"
              >
                <Save className="size-3.5" />
                保存 OCR 配置
              </button>
            </div>
          </div>

          {/* Card 4: 数据属性分类 */}
          <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950 overflow-hidden">
            <div className="p-5 border-b border-zinc-150 dark:border-zinc-850 bg-zinc-50/50 dark:bg-zinc-900/10">
              <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">数据分类与自动标签</h3>
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-1">用于 OCR 完成后自动利用大语言模型评估并分类知识点、解题方法和难度标签。</p>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium text-zinc-500 block">OCR 完成后自动分类</label>
                  <select
                    value={classificationEnabled ? 'true' : 'false'}
                    onChange={(e) => setClassificationEnabled(e.target.value === 'true')}
                    className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none cursor-pointer focus:border-zinc-950 dark:focus:border-zinc-300"
                  >
                    <option value="true">开启自动分类评估</option>
                    <option value="false">关闭自动分类</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium text-zinc-500 block">分类并发数量限制 (1-20)</label>
                  <input
                    type="number"
                    value={cleanupConcurrency}
                    onChange={(e) => setCleanupConcurrency(e.target.value)}
                    className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-950 dark:focus:border-zinc-300"
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-[13px] font-medium text-zinc-500 block">分类 API 服务端点 (留空沿用 OCR 地址)</label>
                  <input
                    type="text"
                    value={cleanupApiUrl}
                    onChange={(e) => setCleanupApiUrl(e.target.value)}
                    placeholder={glmApiUrl}
                    className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-950 dark:focus:border-zinc-300 font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium text-zinc-500 block">分类 API 密钥 (留空沿用 OCR 密钥)</label>
                  <input
                    type="password"
                    value={cleanupApiKey}
                    onChange={(e) => setCleanupApiKey(e.target.value)}
                    placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-950 dark:focus:border-zinc-300 font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium text-zinc-500 block">分类大模型名称</label>
                  <input
                    type="text"
                    value={cleanupModel}
                    onChange={(e) => setCleanupModel(e.target.value)}
                    className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-950 dark:focus:border-zinc-300 font-mono"
                  />
                </div>
              </div>

              {/* Prompts for categorization */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-zinc-100 dark:border-zinc-800 pt-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium text-zinc-500 block">分类 System Prompt</label>
                  <textarea
                    rows={4}
                    value={classSystemPrompt}
                    onChange={(e) => setClassSystemPrompt(e.target.value)}
                    className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-950 dark:focus:border-zinc-300 font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium text-zinc-500 block">分类 User Prompt</label>
                  <textarea
                    rows={4}
                    value={classUserPrompt}
                    onChange={(e) => setClassUserPrompt(e.target.value)}
                    className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-950 dark:focus:border-zinc-300 font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-zinc-150 dark:border-zinc-850 bg-zinc-50/50 dark:bg-zinc-900/10 flex justify-end">
              <button
                onClick={() => triggerSave('属性分类')}
                className="inline-flex items-center gap-1.5 rounded bg-zinc-950 hover:bg-zinc-850 text-zinc-50 text-xs font-semibold px-3 py-1.5 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 transition-colors cursor-pointer"
              >
                <Save className="size-3.5" />
                保存分类设置
              </button>
            </div>
          </div>

          {/* Card 5: OCR 系统提示词配置 */}
          <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950 overflow-hidden">
            <div className="p-5 border-b border-zinc-150 dark:border-zinc-850 bg-zinc-50/50 dark:bg-zinc-900/10">
              <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">OCR 系统提示词</h3>
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-1">控制整卷识别与局部重刷公式时的底层大模型 Prompt。留空则表示使用系统内置默认逻辑。</p>
            </div>

            <div className="p-5 space-y-5">
              <div className="space-y-4">
                <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider block border-b border-zinc-100 pb-1.5 dark:border-zinc-900">整卷试卷识别提示词 (Whole OCR Prompt)</span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-zinc-500 block">整卷 System Prompt</label>
                    <textarea
                      rows={3}
                      value={wholeSystemPrompt}
                      onChange={(e) => setWholeSystemPrompt(e.target.value)}
                      placeholder="留空则使用默认配置..."
                      className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-950 dark:focus:border-zinc-300 font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-zinc-500 block">整卷 User Prompt</label>
                    <textarea
                      rows={3}
                      value={wholeUserPrompt}
                      onChange={(e) => setWholeUserPrompt(e.target.value)}
                      placeholder="留空则使用默认配置..."
                      className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-950 dark:focus:border-zinc-300 font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4 pt-2 border-t border-zinc-100 dark:border-zinc-900">
                <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider block border-b border-zinc-100 pb-1.5 dark:border-zinc-900">分区重刷提示词 (Chunk OCR Prompt)</span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-zinc-500 block">分区 System Prompt</label>
                    <textarea
                      rows={3}
                      value={chunkSystemPrompt}
                      onChange={(e) => setChunkSystemPrompt(e.target.value)}
                      placeholder="留空则使用默认配置..."
                      className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-950 dark:focus:border-zinc-300 font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-zinc-500 block">分区 User Prompt</label>
                    <textarea
                      rows={3}
                      value={chunkUserPrompt}
                      onChange={(e) => setChunkUserPrompt(e.target.value)}
                      placeholder="留空则使用默认配置..."
                      className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-950 dark:focus:border-zinc-300 font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-zinc-150 dark:border-zinc-850 bg-zinc-50/50 dark:bg-zinc-900/10 flex justify-end">
              <button
                onClick={() => triggerSave('OCR 提示词')}
                className="inline-flex items-center gap-1.5 rounded bg-zinc-950 hover:bg-zinc-850 text-zinc-50 text-xs font-semibold px-3 py-1.5 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 transition-colors cursor-pointer"
              >
                <Save className="size-3.5" />
                保存提示词模板
              </button>
            </div>
          </div>

          {/* Card 6: PDF 切题规则与字典 */}
          <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950 overflow-hidden">
            <div className="p-5 border-b border-zinc-150 dark:border-zinc-850 bg-zinc-50/50 dark:bg-zinc-900/10">
              <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">PDF 切题规则与字典</h3>
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-1">维护 PDF 自动切题引擎识别边界所依赖的章节定位和提示干扰词。保存后立即应用于新的识别队列中。</p>
            </div>

            <div className="p-5 space-y-6">
              
              {/* Category sub-tabs switcher */}
              <div className="flex flex-wrap gap-1 bg-zinc-100 dark:bg-zinc-900 p-0.5 rounded-lg border border-zinc-200/50 dark:border-zinc-800/50">
                {ruleCategoriesList.map((cat) => (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => setActiveRuleCat(cat.key)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer ${
                      activeRuleCat === cat.key
                        ? 'bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 shadow-xs border border-zinc-200/20'
                        : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Current tab detail description */}
              <div className="bg-zinc-50 dark:bg-zinc-900/20 rounded-lg p-3 border border-zinc-100 dark:border-zinc-855 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-zinc-850 dark:text-zinc-200">
                    {ruleCategoriesList.find(c => c.key === activeRuleCat)?.label}
                  </h4>
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                    {ruleCategoriesList.find(c => c.key === activeRuleCat)?.desc}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addRuleRow}
                  className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-white hover:bg-zinc-50 text-xs font-semibold text-zinc-700 px-2.5 py-1.5 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-850 cursor-pointer"
                >
                  <Plus className="size-3.5" />
                  新增字典词
                </button>
              </div>

              {/* Slicer rule table */}
              <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
                <div className="bg-zinc-50/70 dark:bg-zinc-900/40 text-[12px] font-semibold text-zinc-500 border-b border-zinc-200 dark:border-zinc-800 px-4 py-2 flex">
                  <span className="w-10 text-center shrink-0">序号</span>
                  <span className="flex-1 px-3">匹配词条</span>
                  <span className="w-24 px-3 text-center">匹配模式</span>
                  <span className="w-16 text-center">状态</span>
                  <span className="w-10 text-center">删除</span>
                </div>
                <div className="divide-y divide-zinc-150 dark:divide-zinc-900 max-h-[300px] overflow-y-auto">
                  {rules[activeRuleCat].length === 0 ? (
                    <div className="p-8 text-center text-xs text-zinc-450 dark:text-zinc-550">
                      该字典分类暂无自定义匹配词，请点击上方“新增字典词”。
                    </div>
                  ) : (
                    rules[activeRuleCat].map((rule, idx) => (
                      <div key={rule.id} className="px-4 py-2 flex items-center hover:bg-zinc-50/40 dark:hover:bg-zinc-900/10">
                        <span className="w-10 text-center text-[11px] text-zinc-400 font-mono shrink-0">{idx + 1}</span>
                        <div className="flex-1 px-3">
                          <input
                            type="text"
                            value={rule.term}
                            onChange={(e) => updateRuleRow(rule.id, 'term', e.target.value)}
                            placeholder="请输入标记词（例如：注意事项）"
                            className="w-full rounded border border-zinc-200 bg-white dark:border-zinc-800 px-2.5 py-1 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-950 dark:focus:border-zinc-300 font-normal"
                          />
                        </div>
                        <div className="w-24 px-3 shrink-0 flex justify-center">
                          <select
                            value={rule.mode}
                            onChange={(e) => updateRuleRow(rule.id, 'mode', e.target.value as any)}
                            className="rounded border border-zinc-200 bg-white dark:border-zinc-800 px-1.5 py-1 text-xs outline-none cursor-pointer"
                          >
                            <option value="contains">包含</option>
                            <option value="exact">精确</option>
                          </select>
                        </div>
                        <div className="w-16 shrink-0 flex justify-center">
                          <button
                            type="button"
                            onClick={() => toggleRuleEnabled(rule.id)}
                            className="p-1 text-zinc-400 hover:text-zinc-650 transition-colors cursor-pointer"
                          >
                            {rule.enabled ? (
                              <ToggleRight className="size-4.5 text-emerald-600" />
                            ) : (
                              <ToggleLeft className="size-4.5 text-zinc-350 dark:text-zinc-700" />
                            )}
                          </button>
                        </div>
                        <div className="w-10 shrink-0 flex justify-center">
                          <button
                            type="button"
                            onClick={() => deleteRuleRow(rule.id)}
                            className="p-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 cursor-pointer"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-zinc-150 dark:border-zinc-850 bg-zinc-50/50 dark:bg-zinc-900/10 flex justify-end">
              <button
                onClick={() => triggerSave('切题规则与字典')}
                className="inline-flex items-center gap-1.5 rounded bg-zinc-950 hover:bg-zinc-850 text-zinc-50 text-xs font-semibold px-3 py-1.5 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 transition-colors cursor-pointer"
              >
                <Save className="size-3.5" />
                保存切题字典
              </button>
            </div>
          </div>

        </div>

        {/* Right Column: Diagnostics & Updates (lg:col-span-1) */}
        <div className="space-y-6">
          
          {/* Card 7: 系统状态诊断 */}
          <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950 overflow-hidden">
            <div className="p-5 border-b border-zinc-150 dark:border-zinc-850 bg-zinc-50/50 dark:bg-zinc-900/10">
              <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">系统运行状态</h3>
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-1">诊断本地运行环境服务及相关编译器套件路径。</p>
            </div>

            <div className="p-5 space-y-3.5 text-[13px]">
              <div className="flex items-center justify-between border-b border-zinc-100 pb-2 dark:border-zinc-900">
                <span className="text-zinc-500 dark:text-zinc-400">本地服务端引擎</span>
                <span className="inline-flex items-center rounded-md border border-emerald-250 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-955/20 dark:text-emerald-400 dark:border-emerald-900/50">
                  运行中 (Port 8000)
                </span>
              </div>

              <div className="flex items-center justify-between border-b border-zinc-100 pb-2 dark:border-zinc-900">
                <span className="text-zinc-500 dark:text-zinc-400">KaTeX 数学渲染</span>
                <span className="inline-flex items-center rounded-md border border-emerald-250 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-955/20 dark:text-emerald-400 dark:border-emerald-900/50">
                  正常 (v0.16.9)
                </span>
              </div>

              <div className="flex items-center justify-between border-b border-zinc-100 pb-2 dark:border-zinc-900">
                <span className="text-zinc-500 dark:text-zinc-400">Python 脚本切片 service</span>
                <span className="inline-flex items-center rounded-md border border-emerald-250 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-955/20 dark:text-emerald-400 dark:border-emerald-900/50">
                  就绪 (v3.11.2)
                </span>
              </div>

              <div className="flex items-center justify-between border-b border-zinc-100 pb-2 dark:border-zinc-900">
                <span className="text-zinc-500 dark:text-zinc-400">XeLaTeX 编译器</span>
                <span className="inline-flex items-center rounded-md border border-emerald-250 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-955/20 dark:text-emerald-400 dark:border-emerald-900/50">
                  就绪 (TeX Live 2024)
                </span>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5 text-left">
                  <span className="text-zinc-500 dark:text-zinc-400 block">LibreOffice 服务</span>
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-550 block">用于转换上传的 Word 格式文件</span>
                </div>
                {sofficeAvailable ? (
                  <span className="inline-flex items-center rounded-md border border-emerald-250 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-955/20 dark:text-emerald-400 dark:border-emerald-900/50">
                    就绪 (v7.6.2)
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-md border border-red-250 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-750 dark:bg-red-955/20 dark:text-red-400 dark:border-red-900/50">
                    未检测到
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Card 8: 应用更新检测 */}
          <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950 overflow-hidden">
            <div className="p-5 border-b border-zinc-150 dark:border-zinc-850 bg-zinc-50/50 dark:bg-zinc-900/10">
              <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">应用版本更新</h3>
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-1">检查最新客户端版本与开源社区发布记录。</p>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="space-y-2">
                <div className="flex justify-between items-center text-[13px]">
                  <span className="text-zinc-500 dark:text-zinc-400">当前版本</span>
                  <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-0.5 text-[11px] font-bold text-zinc-650 dark:bg-zinc-800 dark:text-zinc-400">
                    {currentVersion}
                  </span>
                </div>
                <div className="flex justify-between items-center text-[13px]">
                  <span className="text-zinc-500 dark:text-zinc-400">最新版本</span>
                  <span className="inline-flex items-center rounded-md border border-amber-250 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-955/20 dark:text-amber-400 dark:border-amber-900/50">
                    {latestVersion} (有可用更新)
                  </span>
                </div>
              </div>

              <div className="flex gap-2 border-t border-zinc-100 dark:border-zinc-800 pt-3">
                <button
                  onClick={() => alert('已启动后台下载任务...')}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded bg-zinc-950 hover:bg-zinc-850 text-zinc-50 text-xs font-semibold py-1.5 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 transition-colors cursor-pointer"
                >
                  立即升级至 {latestVersion}
                </button>
                <button
                  onClick={() => alert('已在浏览器中打开 GitHub Releases')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-zinc-200 bg-white hover:bg-zinc-50 text-xs font-semibold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  <ExternalLink className="size-3.5" />
                </button>
              </div>
            </div>
          </div>

        </div>

      </div>

      {/* SAVE TOAST FEEDBACK BANNERS */}
      {showSaveToast && (
        <div className="fixed bottom-6 right-6 bg-zinc-950 border border-zinc-800 rounded-md px-3.5 py-2.5 flex items-center gap-2.5 z-50 text-zinc-50 shadow-lg text-xs animate-fade-in dark:bg-zinc-50 dark:border-zinc-200 dark:text-zinc-950">
          <CheckCircle2 className="size-4.5 text-emerald-500 shrink-0" />
          <div className="space-y-0.5 text-left">
            <span className="font-bold block">配置保存成功</span>
            <span className="text-[10px] text-zinc-400 dark:text-zinc-550 block">{saveToastMsg}</span>
          </div>
        </div>
      )}
    </div>
  )
}
