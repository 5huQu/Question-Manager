import '@fontsource-variable/inter'
import '@fontsource-variable/noto-serif-sc'
import '@fontsource-variable/noto-sans-sc'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)
