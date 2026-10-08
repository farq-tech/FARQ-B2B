import { useEffect, useState } from 'react'
import { ProcurementProvider, useProcurement } from './procurementContext'
import { useFarqSession } from './api/useFarqSession'
import { farqSession } from './api/farqSession'
import { LoginV2 } from './views/LoginV2'
import { RfqListV2 } from './views/RfqListV2'
import { RequestTrackingV2 } from './views/RequestTrackingV2'
import { ComparisonV2 } from './views/ComparisonV2'
import { NewRequestV2 } from './views/NewRequestV2'
import { Button, MobileBottomNav, NavItem, Sidebar as UiSidebar, useIsMobile } from './ui'

/*
 * «فرق تسعير» — owner-only. Two gates: the hosting server asks for the site
 * password before serving anything, and the app itself accepts only the
 * accounts listed in VITE_ALLOWED_EMAILS (default: the owner) after Farq login.
 */
const ALLOWED = String(import.meta.env.VITE_ALLOWED_EMAILS || 'abdulrhman@farq.sa').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean)

// Targeting (screens 07–10) is not ported; the approved plan links to the hosted tool instead.
const TARGETING_URL = 'https://farq-targeting-production-4687.up.railway.app'

function Sidebar() {
  const { view, navigate } = useProcurement()
  const session = useFarqSession()
  const email = String(session.user?.email || '')
  const onRequests = view === 'rfq-list' || view === 'rfq-detail' || view === 'comparison'
  return (
    <UiSidebar
      onNewRequest={() => navigate('create-upload')}
      nav={<>
        <NavItem icon="list" label="طلبات التسعير" active={onRequests} onClick={() => navigate('rfq-list')} />
        <NavItem icon="map-pin" label="الاستهداف" href={TARGETING_URL} external />
      </>}
      account={{ name: email || '—', detail: 'تسجيل الخروج', onSignOut: () => void farqSession.signOut() }}
    />
  )
}

function Routes() {
  const { view, navigate } = useProcurement()
  const session = useFarqSession()
  const [checked, setChecked] = useState<'pending' | 'ok' | 'denied'>('pending')
  const mobile = useIsMobile()

  useEffect(() => {
    if (!session.isAuthenticated) { setChecked('pending'); return }
    const email = String(session.user?.email || '').toLowerCase()
    if (!email) return
    setChecked(ALLOWED.includes(email) ? 'ok' : 'denied')
  }, [session.isAuthenticated, session.user])

  if (!session.isAuthenticated) return <LoginV2 navigate={navigate} />
  if (checked === 'denied') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="font-[Readex_Pro] text-[24px] font-semibold">هذه الصفحة خاصة</p>
        <p style={{ color: 'var(--color-text-secondary)' }}>الحساب الذي سجّلت به غير مصرّح له بدخول «فرق تسعير».</p>
        <Button variant="Primary" size="L" onClick={() => void farqSession.signOut()}>تسجيل الخروج</Button>
      </div>
    )
  }
  if (checked === 'pending') return <div className="p-8 text-right" style={{ color: 'var(--color-text-secondary)' }}>جارٍ التحقق من الحساب…</div>
  // The new-request flow is a full-page wizard (Figma 01/02 have no sidebar).
  if (view === 'create-upload') return <NewRequestV2 navigate={navigate} />
  const onRequests = view === 'rfq-list' || view === 'rfq-detail' || view === 'comparison'
  return (
    <div className="flex min-h-screen">
      {mobile ? null : <Sidebar />}
      <main className={mobile ? 'min-w-0 flex-1 pb-[72px]' : 'min-w-0 flex-1'}>
        {view === 'rfq-detail' && <RequestTrackingV2 navigate={navigate} />}
        {view === 'comparison' && <ComparisonV2 navigate={navigate} />}
        {view !== 'rfq-detail' && view !== 'comparison' && <RfqListV2 navigate={navigate} />}
      </main>
      {mobile ? (
        // Figma «Mobile Bottom Nav» (55:551): only the sections that exist are shown.
        <MobileBottomNav tabs={[
          { label: 'الطلبات', icon: 'list', active: onRequests, onClick: () => navigate('rfq-list') },
          { label: 'طلب جديد', icon: 'plus', onClick: () => navigate('create-upload') },
          { label: 'الاستهداف', icon: 'map-pin', href: TARGETING_URL },
        ]} />
      ) : null}
    </div>
  )
}

export default function App() {
  return (
    <ProcurementProvider>
      <Routes />
    </ProcurementProvider>
  )
}
