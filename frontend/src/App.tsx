import { useEffect, useState } from 'react'
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import 'katex/dist/katex.min.css'
import { FilterX, Plus, ShoppingBag } from 'lucide-react'
import { settingsApi } from '@/api/settings'
import { collectionsApi } from '@/api/collections'
import { QuestionBasket } from '@/components/QuestionBasket'
import { UpdateCard } from '@/components/UpdateCard'
import { AppPageHeader } from '@/components/layout/AppPageHeader'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import TraditionalWorkbenchPage from '@/pages/workbench/TraditionalWorkbenchPage'
import PdfSlicerPage from '@/pages/pdf-slicer/PdfSlicerPage'
import OcrQueuePage from '@/pages/ocr/OcrQueuePage'
import QuestionBankPage from '@/pages/questions/QuestionBankPage'
import QuestionCreatePage from '@/pages/questions/QuestionCreatePage'
import QuestionDetailPage from '@/pages/questions/QuestionDetailPage'
import RunQuestionsPage from '@/pages/questions/RunQuestionsPage'
import MarkdownPreviewPage from '@/pages/questions/MarkdownPreviewPage'
import PendingBankPage from '@/pages/PendingBankPage'
import LearningTagsPage from '@/pages/LearningTagsPage'
import SettingsPage from '@/pages/SettingsPage'
import ExportRecordsPage from '@/pages/ExportRecordsPage'
import { SetupPage } from '@/pages/SetupPage'
import type { OcrSettings } from '@/types'
import type { UpdateCheckResult } from '@/api/client'

function NavigateToWorkbench() {
  const navigate = useNavigate()
  useEffect(() => {
    navigate('/workbench', { replace: true })
  }, [navigate])
  return null
}

export default function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('theme') === 'dark')
  const [settingsReady, setSettingsReady] = useState(false)
  const [availableUpdate, setAvailableUpdate] = useState<UpdateCheckResult | null>(null)
  const [appSettings, setAppSettings] = useState({
    setupCompleted: false,
    systemName: 'Question Manager',
    siteTitle: 'Question Manager',
    siteDescription: '',
  })

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
  }, [darkMode])

  useEffect(() => {
    function handleSettingsUpdated(event: Event) {
      const settings = (event as CustomEvent<Partial<OcrSettings>>).detail
      if (settings) applySettings(settings)
    }
    window.addEventListener('app-settings-updated', handleSettingsUpdated)
    settingsApi.getSettings()
      .then(applySettings)
      .catch(() => undefined)
      .finally(() => setSettingsReady(true))
    return () => window.removeEventListener('app-settings-updated', handleSettingsUpdated)
  }, [])

  function applySettings(settings: Partial<OcrSettings>) {
    const next = {
      setupCompleted: settings.setupCompleted ?? appSettings.setupCompleted,
      systemName: settings.systemName || 'Question Manager',
      siteTitle: settings.siteTitle || 'Question Manager',
      siteDescription: settings.siteDescription || '',
    }
    setAppSettings(next)
    document.title = next.siteTitle
    const description = document.querySelector('meta[name="description"]') || document.head.appendChild(document.createElement('meta'))
    description.setAttribute('name', 'description')
    description.setAttribute('content', next.siteDescription)
  }

  if (!settingsReady) {
    return <div className="min-h-screen bg-background" />
  }

  if (!appSettings.setupCompleted || location.pathname === '/setup') {
    return <SetupPage initialSettings={appSettings} onComplete={applySettings} />
  }

  return (
    <SidebarProvider className={`h-screen overflow-hidden bg-background text-[var(--app-body-text)] text-foreground transition-colors duration-150 ${darkMode ? 'dark' : ''}`}>
      <AppSidebar
        darkMode={darkMode}
        systemName={appSettings.systemName}
        onThemeToggle={() => setDarkMode(!darkMode)}
      />

      <SidebarInset className="h-screen min-w-0 overflow-hidden transition-colors duration-150">
        <AppPageHeader actions={
          location.pathname === '/questions'
            ? <QuestionBankHeaderActions />
            : undefined
        } />
        <div className="flex-1 overflow-auto">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6">
            <Routes>
              <Route path="/" element={<NavigateToWorkbench />} />
              <Route path="/workbench" element={<TraditionalWorkbenchPage />} />
              <Route path="/tools/pdf-slicer" element={<PdfSlicerPage />} />
              <Route path="/tools/pdf-slicer/ocr-jobs" element={<OcrQueuePage />} />
              <Route path="/questions" element={<QuestionBankPage />} />
              <Route path="/questions/new" element={<QuestionCreatePage />} />
              <Route path="/questions/basket" element={<QuestionBasket mode="page" />} />
              <Route path="/questions/:id" element={<QuestionDetailPage />} />
              <Route path="/questions/collections/:id/markdown-preview" element={<MarkdownPreviewPage />} />
              <Route path="/learning-tags" element={<LearningTagsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/exports" element={<ExportRecordsPage />} />
              <Route path="/tools/pdf-slicer/runs/:runId/questions" element={<RunQuestionsPage />} />
              <Route path="/tools/pdf-slicer/runs/:runId/pending-bank" element={<PendingBankPage />} />

            </Routes>
          </div>
        </div>
      </SidebarInset>
      <QuestionBasket mode="drawer" />
      {availableUpdate && location.pathname !== '/settings' ? (
        <div className="fixed bottom-5 right-5 z-50 w-[min(360px,calc(100vw-2.5rem))] rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
          <UpdateCard compact initialResult={availableUpdate} onUpdateAvailable={setAvailableUpdate} />
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAvailableUpdate(null)}
              className="h-8 rounded-lg px-2.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              稍后
            </button>
            <button
              type="button"
              onClick={() => navigate('/settings?tab=updates')}
              className="h-8 rounded-lg bg-zinc-950 px-2.5 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950"
            >
              去更新
            </button>
          </div>
        </div>
      ) : null}
      <UpdateAutoCheck enabled={!availableUpdate} onUpdateAvailable={setAvailableUpdate} />
    </SidebarProvider>
  )
}

function UpdateAutoCheck({ enabled, onUpdateAvailable }: {
  enabled: boolean
  onUpdateAvailable: (result: UpdateCheckResult) => void
}) {
  useEffect(() => {
    const updates = window.questionWorkbench?.updates
    if (!enabled || !updates) return undefined
    const timer = window.setTimeout(() => {
      updates.check({ silent: true })
        .then((result) => {
          if (result.updateAvailable) onUpdateAvailable(result)
        })
        .catch(() => undefined)
    }, 8000)
    return () => window.clearTimeout(timer)
  }, [enabled, onUpdateAvailable])

  return null
}

const RESET_FILTERS_EVENT = 'question-bank-reset-filters'

export function dispatchResetFilters() {
  window.dispatchEvent(new Event(RESET_FILTERS_EVENT))
}

export function QuestionBankHeaderActions() {
  const navigate = useNavigate()
  const [basketCount, setBasketCount] = useState(0)

  useEffect(() => {
    async function loadCount() {
      try {
        const id = localStorage.getItem('question-manager.activeCollectionId') || 'basket'
        const data = await collectionsApi.getCollection(id)
        setBasketCount(data.questionCount ?? data.questions?.length ?? 0)
      } catch (e) {
        console.error(e)
      }
    }
    loadCount()
    window.addEventListener('question-basket-updated', loadCount)
    return () => window.removeEventListener('question-basket-updated', loadCount)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => navigate('/questions/basket')}
        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
      >
        <ShoppingBag className="size-3.5 text-zinc-500 dark:text-zinc-400" /> 试题篮 ({basketCount})
      </button>
      <button
        type="button"
        onClick={() => navigate('/questions/new')}
        className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-50 shadow hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 transition-colors cursor-pointer"
      >
        <Plus className="size-3.5" /> 新增题目
      </button>
    </>
  )
}
