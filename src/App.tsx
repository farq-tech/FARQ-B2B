import { lazy, Suspense, useEffect, useState } from 'react'
import { ProcurementProvider, useProcurement } from './procurementContext'
import { useFarqSession } from './api/useFarqSession'
import { farqSession } from './api/farqSession'
import { LoginV2 } from './views/LoginV2'
import { Button, MobileBottomNav, NavItem, Sidebar as UiSidebar, useIsMobile } from './ui'
import LiveBackground from './live-bg'

// Each screen is its own chunk (routes in procurementContext.tsx).
const RfqListV2 = lazy(() => import('./views/RfqListV2').then((m) => ({ default: m.RfqListV2 })))
const RequestTrackingV2 = lazy(() => import('./views/RequestTrackingV2').then((m) => ({ default: m.RequestTrackingV2 })))
const ComparisonV2 = lazy(() => import('./views/ComparisonV2').then((m) => ({ default: m.ComparisonV2 })))
const NewRequestV2 = lazy(() => import('./views/NewRequestV2').then((m) => ({ default: m.NewRequestV2 })))
const AwardPage = lazy(() => import('./pages/award'))
const InboxPage = lazy(() => import('./pages/inbox'))
const TargetingPage = lazy(() => import('./pages/targeting'))
const TemplatesPage = lazy(() => import('./pages/targeting/Templates'))
const TemplateEditor = lazy(() => import('./pages/targeting/TemplateEditor'))

const Loading = () => <div className="p-8 text-right" role="status" style={{ color: 'var(--color-text-secondary)' }}>جارٍ التحميل…</div>

/* Account login; authorized emails retain access to the private app. */
const ALLOWED = String(import.meta.env.VITE_ALLOWED_EMAILS || 'abdulrhman@farq.sa').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean)

const onTargeting = (v: string) => v === 'targeting' || v === 'templates' || v === 'template-new'

function Sidebar() {
  const { view, navigate } = useProcurement()
  const session = useFarqSession()
  const email = String(session.user?.email || '')
  const onRequests = view === 'rfq-list' || view === 'rfq-detail' || view === 'comparison' || view === 'award'
  return (
    <UiSidebar
      onNewRequest={() => navigate('create-upload')}
      nav={<>
        <NavItem icon="list" label="طلبات التسعير" active={onRequests} onClick={() => navigate('rfq-list')} />
        <NavItem icon="inbox" label="صندوق الوارد" active={view === 'inbox'} onClick={() => navigate('inbox')} />
        <NavItem icon="map-pin" label="الاستهداف" active={onTargeting(view)} onClick={() => navigate('targeting')} />
      </>}
      account={{ name: email || '—', detail: 'تسجيل الخروج', onSignOut: () => void farqSession.signOut() }}
    />
  )
}

function Routes() {
  const { view, navigate, selectedRfqId, setSelectedRfqId } = useProcurement()
  const session = useFarqSession()
  const [checked, setChecked] = useState<'pending' | 'ok' | 'denied'>('pending')
  const mobile = useIsMobile()

  useEffect(() => {
    if (!session.isAuthenticated) { setChecked('pending'); return }
    const email = String(session.user?.email || '').toLowerCase()
    if (!email) return
    setChecked(ALLOWED.includes(email) ? 'ok' : 'denied')
  }, [session.isAuthenticated, session.user])
  // /login while already signed in → the requests list
  useEffect(() => { if (session.isAuthenticated && view === 'login') navigate('rfq-list') }, [session.isAuthenticated, view, navigate])

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
  if (view === 'create-upload') return <Suspense fallback={<Loading />}><NewRequestV2 navigate={navigate} /></Suspense>
  const onRequests = view === 'rfq-list' || view === 'rfq-detail' || view === 'comparison' || view === 'award'
  const openRequest = (id: string) => { setSelectedRfqId(id); navigate('rfq-detail') }
  return (
    <div className="flex min-h-screen">
      {mobile ? null : <Sidebar />}
      <main className={mobile ? 'min-w-0 flex-1 pb-[72px]' : 'min-w-0 flex-1'}>
        <Suspense fallback={<Loading />}>
          {view === 'rfq-detail' && <RequestTrackingV2 navigate={navigate} />}
          {view === 'comparison' && <ComparisonV2 navigate={navigate} />}
          {view === 'award' && selectedRfqId && (
            <AwardPage rfqId={selectedRfqId} supplierId={new URLSearchParams(window.location.search).get('supplier')}
              onBack={() => navigate('comparison')} onDone={() => navigate('rfq-detail')} />
          )}
          {view === 'inbox' && <InboxPage onOpenRequest={openRequest} />}
          {view === 'targeting' && <TargetingPage onTemplates={() => navigate('templates')} />}
          {view === 'templates' && <TemplatesPage onBack={() => navigate('targeting')} onNew={() => navigate('template-new')} />}
          {view === 'template-new' && <TemplateEditor onBack={() => navigate('templates')} />}
          {(view === 'rfq-list' || view === 'login' || (view === 'award' && !selectedRfqId)) && <RfqListV2 navigate={navigate} />}
        </Suspense>
      </main>
      {mobile ? (
        // Figma «Mobile Bottom Nav» (55:551): only the sections that exist are shown.
        <MobileBottomNav tabs={[
          { label: 'الطلبات', icon: 'list', active: onRequests, onClick: () => navigate('rfq-list') },
          { label: 'طلب جديد', icon: 'plus', onClick: () => navigate('create-upload') },
          { label: 'الوارد', icon: 'inbox', active: view === 'inbox', onClick: () => navigate('inbox') },
          { label: 'الاستهداف', icon: 'map-pin', active: onTargeting(view), onClick: () => navigate('targeting') },
        ]} />
      ) : null}
    </div>
  )
}

export default function App() {
  return (
    <ProcurementProvider>
      <LiveBackground />
      <Routes />
    </ProcurementProvider>
  )
}
