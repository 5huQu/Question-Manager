import '@fontsource-variable/inter'
import '@fontsource-variable/noto-serif-sc'
import '@fontsource-variable/noto-sans-sc'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import { AuthGate } from './auth/AuthGate'
import './index.css'
import { QUESTION_MATH_LATIN_FONT_FACE_CSS } from '@/utils/teachingDocument/lectureFonts'

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <style data-question-math-font>{QUESTION_MATH_LATIN_FONT_FACE_CSS}</style>
    <AuthProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </AuthProvider>
  </BrowserRouter>
)
