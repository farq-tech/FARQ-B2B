import { lazy, Suspense, useEffect, useState } from 'react'
import { ProcurementProvider, useProcurement, type View } from './procurementContext'
import { useFarqSession } from './api/useFarqSession'
import { farqSession } from './api/farqSession'
import { LoginV2 } from './views/LoginV2'
import { Button, MobileBottomNav, NavItem, Sidebar, useIsMobile } from './ui'
import './b2b/b2b.css'

/*
 * Shell = Figma «✦ Farq B2B: Screens» (file gxlY4uu8hzkUNrcN61uQZt): web W00 sidebar 18371:99,
 * mobile Tab Bars (4): الطلبات · طلب جديد · الوارد · الموردين. «الموردين» opens the supplier campaign
 * (targeting map → message → Meta approval → review & cost). Explore (/explore), opportunities and
 * account stay reachable (landing entry, saved opportunities, «حسابي» under the account row).
 */
const RfqList = lazy(() => import('./views/RfqListV2').then(m => ({ default: m.RfqListV2 })))
const Tracking = lazy(() => import('./views/RequestTrackingV2').then(m => ({ default: m.RequestTrackingV2 })))
const Comparison = lazy(() => import('./views/ComparisonV2').then(m => ({ default: m.ComparisonV2 })))
const NewRequest = lazy(() => import('./views/NewRequestV2').then(m => ({ default: m.NewRequestV2 })))
const Award = lazy(() => import('./pages/award'))
const Inbox = lazy(() => import('./pages/inbox'))
const Targeting = lazy(() => import('./pages/targeting'))
const Templates = lazy(() => import('./pages/targeting/Templates'))
const TemplateEditor = lazy(() => import('./pages/targeting/TemplateEditor'))
const Explore = lazy(() => import('./b2b/Explore'))
const Account = lazy(() => import('./b2b/Account'))
const Opportunities = lazy(() => import('./b2b/Opportunities'))
const Loading = () => <p role="status" className="farq-loading">جارٍ التحميل…</p>
const ALLOWED = String(import.meta.env.VITE_ALLOWED_EMAILS || 'abdulrhman@farq.sa').toLowerCase().split(',').map(s => s.trim()).filter(Boolean)

const REQUESTS: View[] = ['rfq-list', 'rfq-detail', 'comparison', 'award', 'login']
const CAMPAIGN: View[] = ['targeting', 'templates', 'template-new']

/** The landing's «حدد هدفك وابدأ» stores a goal; that visit opens Explore once, later visits open the requests. */
function landingGoal(): boolean {
  try { return Boolean(sessionStorage.getItem('farq-entry-goal')) } catch { return false }
}

function SectionLabel({ children }: { children: string }) {
  return <p className="px-3 pt-3 pb-1 text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">{children}</p>
}

function Routes() {
  const { view, navigate, selectedRfqId, setSelectedRfqId } = useProcurement()
  const session = useFarqSession()
  const mobile = useIsMobile()
  const [checked, setChecked] = useState<'pending' | 'ok' | 'denied'>('pending')
  const email = String(session.user?.email || '')
  useEffect(() => {
    if (!session.isAuthenticated) { setChecked('pending'); return }
    const e = email.toLowerCase()
    if (e) setChecked(ALLOWED.includes(e) ? 'ok' : 'denied')
  }, [session.isAuthenticated, email])
  useEffect(() => { if (session.isAuthenticated && view === 'login') navigate(landingGoal() ? 'explore' : 'rfq-list') }, [session.isAuthenticated, view, navigate])

  if (!session.isAuthenticated) return <LoginV2 navigate={navigate} />
  if (checked === 'denied') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="font-[family-name:var(--font-display)] text-[24px] font-semibold">هذه الصفحة خاصة</h1>
        <p className="text-[var(--color-text-secondary)]">دخلت بـ <bdi dir="ltr">{email}</bdi>، وهذا الحساب ما عنده صلاحية على «فرق تسعير».</p>
        <Button variant="Primary" size="L" onClick={() => void farqSession.signOut()}>ادخل بحساب آخر</Button>
      </main>
    )
  }
  if (checked === 'pending') return <Loading />
  // The new-request flow is a full-page wizard (Figma M01a/M01b have no tab bar).
  if (view === 'create-upload') return <Suspense fallback={<Loading />}><NewRequest navigate={navigate} /></Suspense>

  const onRequests = REQUESTS.includes(view)
  const onCampaign = CAMPAIGN.includes(view)
  const openRequest = (id: string) => { setSelectedRfqId(id); navigate('rfq-detail') }
  return (
    <div className="flex min-h-screen">
      {mobile ? null : (
        <Sidebar
          className="sticky top-0"
          nav={<>
            <SectionLabel>التسعير</SectionLabel>
            <NavItem icon="list" label="طلبات التسعير" active={onRequests} onClick={() => navigate('rfq-list')} />
            <NavItem icon="plus" label="طلب جديد" onClick={() => navigate('create-upload')} />
            <SectionLabel>الموردين</SectionLabel>
            <NavItem icon="inbox" label="صندوق الوارد" active={view === 'inbox'} onClick={() => navigate('inbox')} />
            <NavItem icon="map-pin" label="حملات الموردين" active={view === 'targeting'} onClick={() => navigate('targeting')} />
            <NavItem icon="whatsapp" label="قوالب واتساب" active={view === 'templates' || view === 'template-new'} onClick={() => navigate('templates')} />
          </>}
          footerNav={<NavItem icon="building" label="حسابي" active={view === 'account'} onClick={() => navigate('account')} />}
          account={{ name: email || 'المالك', detail: 'تسجيل الخروج', onSignOut: () => void farqSession.signOut() }}
        />
      )}
      <main id="farq-main" tabIndex={-1} className={mobile ? 'min-w-0 flex-1 pb-[72px]' : 'min-w-0 flex-1'}>
        <Suspense fallback={<Loading />}>
          {(view === 'explore' || view === 'goal-new') && <Explore />}
          {view === 'rfq-detail' && <Tracking navigate={navigate} />}
          {view === 'comparison' && <Comparison navigate={navigate} />}
          {view === 'award' && selectedRfqId && <Award rfqId={selectedRfqId} supplierId={new URLSearchParams(window.location.search).get('supplier')} onBack={() => navigate('comparison')} onDone={() => navigate('rfq-detail')} />}
          {view === 'inbox' && <Inbox onOpenRequest={openRequest} />}
          {view === 'targeting' && <Targeting onTemplates={() => navigate('templates')} />}
          {view === 'templates' && <Templates onBack={() => navigate('targeting')} onNew={() => navigate('template-new')} />}
          {view === 'template-new' && <TemplateEditor onBack={() => navigate('templates')} />}
          {view === 'account' && <Account />}
          {view === 'opportunities' && <Opportunities />}
          {(view === 'rfq-list' || view === 'login' || (view === 'award' && !selectedRfqId)) && <RfqList navigate={navigate} />}
        </Suspense>
      </main>
      {mobile ? (
        <MobileBottomNav tabs={[
          { label: 'الطلبات', icon: 'list', active: onRequests, onClick: () => navigate('rfq-list') },
          { label: 'طلب جديد', icon: 'plus', onClick: () => navigate('create-upload') },
          { label: 'الوارد', icon: 'inbox', active: view === 'inbox', onClick: () => navigate('inbox') },
          { label: 'الموردين', icon: 'map-pin', active: onCampaign, onClick: () => navigate('targeting') },
        ]} />
      ) : null}
    </div>
  )
}

export default function App() {
  useEffect(() => { document.documentElement.dataset.farqApp = 'b2b'; return () => { delete document.documentElement.dataset.farqApp } }, [])
  return <ProcurementProvider><div className="farq-b2b" data-farq-b2b><Routes /></div></ProcurementProvider>
}
