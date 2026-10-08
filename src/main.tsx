import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

const harness = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('harness') : null
if (import.meta.env.DEV && window.location.pathname === '/ui') {
  // Dev-only component gallery (src/ui next to Figma). Tree-shaken out of `vite build`.
  void import('./dev/uiGallery').then((m) => m.mountGallery())
} else if (import.meta.env.DEV && harness) {
  // Dev-only visual harness (fixtures, no login). Tree-shaken out of `vite build`.
  void import('./dev/harness').then((m) => m.mountHarness(harness))
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
