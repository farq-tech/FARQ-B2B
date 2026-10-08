import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

const harness = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('harness') : null
if (import.meta.env.DEV && harness) {
  // Dev-only visual harness (fixtures, no login). Tree-shaken out of `vite build`.
  void import('./dev/harness').then((m) => m.mountHarness(harness))
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
