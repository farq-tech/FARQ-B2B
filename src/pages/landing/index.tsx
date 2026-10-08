import { Component, lazy, Suspense, useEffect, type ReactNode } from 'react'
import { cx, FOCUS_RING } from '../../ui/cx'
import { applySeo } from './seo'
import { Hero, SiteHeader } from './sections/Hero'
import { WHATSAPP_HREF } from './contact'
import { Container, T } from './kit'

/*
 * «فرق تسعير» public landing page — Figma «Landing — Desktop 1440» (33:2) and «Mobile» (60:728).
 * Public, no login. Imports nothing from src/api, src/views, src/lib or procurementContext, so it builds as
 * its own chunk. The hero is in this module (paints first); everything below loads as a second chunk.
 * Routing: the Lead mounts this default export at «/» (docs/qa/requests.md).
 */

const loadBelow = () => import('./sections/Below')
const Below = lazy(loadBelow)
const Footer = lazy(() => loadBelow().then((m) => ({ default: m.Footer })))

/** Loading state for the lazy part: reserves space, announced politely, no layout jump for the hero. */
function BelowFallback() {
  return (
    <output aria-live="polite" className="block min-h-[60vh] bg-[var(--color-bg-canvas)]">
      <Container className="flex flex-col gap-[var(--space-16)] py-[var(--space-48)]">
        <span className="sr-only">جارٍ تحميل باقي الصفحة…</span>
        <div aria-hidden="true" className="mx-auto h-10 w-2/3 max-w-[420px] animate-pulse rounded-[var(--radius-md)] bg-[var(--color-bg-surface-2)] motion-reduce:animate-none" />
        <div aria-hidden="true" className="h-[240px] animate-pulse rounded-[var(--radius-xl)] bg-[var(--color-bg-surface-2)] motion-reduce:animate-none" />
      </Container>
    </output>
  )
}

/** Error state: the lazy chunk failed (offline / deploy swapped files). Contact stays reachable. */
class BelowBoundary extends Component<{ children: ReactNode; silent?: boolean }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    if (this.props.silent) return null
    return (
      <div role="alert" className="bg-[var(--color-bg-canvas)] py-[var(--space-48)]">
        <Container className="flex flex-col items-center gap-[var(--space-12)] text-center">
          <p className={cx(T.bodyM, 'text-[var(--color-text-primary)]')}>ما قدرنا نحمّل باقي الصفحة.</p>
          <p className={cx(T.small, 'text-[var(--color-text-secondary)]')}>تأكد من الاتصال وحدّث الصفحة، أو كلمنا مباشرة.</p>
          <div className="flex gap-[var(--space-12)]">
            <button type="button" onClick={() => window.location.reload()} className={cx(T.smallM, 'h-10 rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-[var(--space-16)] text-[var(--color-text-primary)]', FOCUS_RING)}>
              حدّث الصفحة
            </button>
            <a href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer" className={cx(T.smallM, 'inline-flex h-10 items-center rounded-[var(--radius-md)] bg-[var(--color-bg-cta)] px-[var(--space-16)] text-[var(--color-text-on-cta)]', FOCUS_RING)}>
              كلمنا واتساب
            </a>
          </div>
        </Container>
      </div>
    )
  }
}

export default function LandingPage() {
  useEffect(() => applySeo(), [])
  return (
    <div lang="ar" dir="rtl" className="min-h-screen bg-[var(--color-bg-canvas)] font-sans text-[var(--color-text-primary)] scroll-smooth">
      <a href="#main" className={cx('sr-only focus:not-sr-only focus:fixed focus:start-[var(--space-16)] focus:top-[var(--space-16)] focus:z-50 focus:rounded-[var(--radius-md)] focus:bg-[var(--color-bg-surface)] focus:px-[var(--space-16)] focus:py-[var(--space-8)] focus:text-[var(--brand-text)]', FOCUS_RING)}>
        تخطَّ إلى المحتوى
      </a>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="outline-none">
        <Hero />
        <BelowBoundary>
          <Suspense fallback={<BelowFallback />}>
            <Below />
          </Suspense>
        </BelowBoundary>
      </main>
      <BelowBoundary silent>
        <Suspense fallback={null}>
          <Footer />
        </Suspense>
      </BelowBoundary>
    </div>
  )
}
