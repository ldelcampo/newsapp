import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@fontsource-variable/sora'
import '@fontsource-variable/inter'
import './styles.css'
import { applyTheme } from './theme'

void window.hub.getSettings().then((s) => applyTheme(s.theme))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
