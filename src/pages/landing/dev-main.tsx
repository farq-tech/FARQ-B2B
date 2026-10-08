// Dev-only preview entry for the landing page (opened at /src/pages/landing/dev.html). Not in the build.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../index.css'
import LandingPage from './index'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LandingPage />
  </StrictMode>,
)
