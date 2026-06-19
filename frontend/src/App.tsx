import { useEffect, useState } from 'react'
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import 'katex/dist/katex.min.css'
import { api } from '@/api/client'
import { QuestionBasket } from '@/components/QuestionBasket'
import { AppSidebar } from '@/components/layout/AppSidebar'
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

function NavigateToWorkbench() {
  const navigate = useNavigate()
  useEffect(() => {
    navigate('/workbench', { replace: true })
  }, [navigate])
  return null
}

export default function App() {
  const location = useLocation()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('theme') === 'dark')
  const [settingsReady, setSettingsReady] = useState(false)
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
    api<OcrSettings>('/api/settings')
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
    return <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950" />
  }

  if (!appSettings.setupCompleted || location.pathname === '/setup') {
    return <SetupPage initialSettings={appSettings} onComplete={applySettings} />
  }

  return (
    <div className={`flex min-h-screen text-[var(--app-body-text)] transition-colors duration-150 ${
      darkMode ? 'dark bg-zinc-950 text-zinc-100' : 'bg-zinc-50 text-zinc-900'
    }`}>
      <AppSidebar
        collapsed={sidebarCollapsed}
        darkMode={darkMode}
        systemName={appSettings.systemName}
        onThemeToggle={() => setDarkMode(!darkMode)}
        onToggleCollapsed={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      <main className="flex-1 flex flex-col min-w-0 min-h-screen overflow-hidden bg-zinc-50 dark:bg-zinc-950 transition-colors duration-150">
        <div className="flex-1 p-5 sm:p-6 lg:p-8 overflow-auto">
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
      </main>
      <QuestionBasket mode="drawer" />
    </div>
  )
}
