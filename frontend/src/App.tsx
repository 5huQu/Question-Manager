import { useEffect, useState } from 'react'
import { Route, Routes, useNavigate } from 'react-router-dom'
import 'katex/dist/katex.min.css'
import { QuestionBasket } from '@/components/QuestionBasket'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { OcrSettingsDialog } from '@/components/dialogs/OcrSettingsDialog'
import TraditionalWorkbenchPage from '@/pages/workbench/TraditionalWorkbenchPage'
import PdfSlicerPage from '@/pages/pdf-slicer/PdfSlicerPage'
import OcrQueuePage from '@/pages/ocr/OcrQueuePage'
import QuestionBankPage from '@/pages/questions/QuestionBankPage'
import QuestionCreatePage from '@/pages/questions/QuestionCreatePage'
import QuestionDetailPage from '@/pages/questions/QuestionDetailPage'
import RunQuestionsPage from '@/pages/questions/RunQuestionsPage'
import MarkdownPreviewPage from '@/pages/questions/MarkdownPreviewPage'
import PendingBankPage from '@/pages/PendingBankPage'

function NavigateToWorkbench() {
  const navigate = useNavigate()
  useEffect(() => {
    navigate('/workbench', { replace: true })
  }, [navigate])
  return null
}

export default function App() {
  const [ocrSettingsOpen, setOcrSettingsOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('theme') === 'dark')

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
  }, [darkMode])

  return (
    <div className={`flex min-h-screen text-[13px] transition-colors duration-150 ${
      darkMode ? 'dark bg-zinc-950 text-zinc-100' : 'bg-zinc-50 text-zinc-900'
    }`}>
      <AppSidebar
        collapsed={sidebarCollapsed}
        darkMode={darkMode}
        onSettingsOpen={() => setOcrSettingsOpen(true)}
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
            <Route path="/questions/:id" element={<QuestionDetailPage />} />
            <Route path="/questions/collections/:id/markdown-preview" element={<MarkdownPreviewPage />} />
            <Route path="/tools/pdf-slicer/runs/:runId/questions" element={<RunQuestionsPage />} />
            <Route path="/tools/pdf-slicer/runs/:runId/pending-bank" element={<PendingBankPage />} />
          </Routes>
        </div>
        {ocrSettingsOpen ? <OcrSettingsDialog onClose={() => setOcrSettingsOpen(false)} /> : null}
      </main>
      <QuestionBasket />
    </div>
  )
}
