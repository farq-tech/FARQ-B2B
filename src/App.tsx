import { lazy, Suspense, useEffect, useState } from 'react'
import { ProcurementProvider, useProcurement } from './procurementContext'
import { useFarqSession } from './api/useFarqSession'
import { farqSession } from './api/farqSession'
import { LoginV2 } from './views/LoginV2'
import { Button, Icon } from './ui'
import Brand from './b2b/Brand'
import './b2b/b2b.css'

const RfqList = lazy(() => import('./views/RfqListV2').then(m => ({ default: m.RfqListV2 })))
const Tracking = lazy(() => import('./views/RequestTrackingV2').then(m => ({ default: m.RequestTrackingV2 })))
const Comparison = lazy(() => import('./views/ComparisonV2').then(m => ({ default: m.ComparisonV2 })))
const NewRequest = lazy(() => import('./views/NewRequestV2').then(m => ({ default: m.NewRequestV2 })))
const Award = lazy(() => import('./pages/award'))
const Inbox = lazy(() => import('./pages/inbox'))
const Explore = lazy(() => import('./b2b/Explore'))
const Account = lazy(() => import('./b2b/Account'))
const Opportunities = lazy(() => import('./b2b/Opportunities'))
const Templates = lazy(() => import('./pages/targeting/Templates'))
const TemplateEditor = lazy(() => import('./pages/targeting/TemplateEditor'))
const Loading = () => <p role="status" className="farq-loading">جارٍ التحميل…</p>
const ALLOWED = String(import.meta.env.VITE_ALLOWED_EMAILS || 'abdulrhman@farq.sa').toLowerCase().split(',').map(s => s.trim()).filter(Boolean)

function Routes() {
  const { view, navigate, selectedRfqId, setSelectedRfqId } = useProcurement()
  const session = useFarqSession()
  const [checked, setChecked] = useState<'pending' | 'ok' | 'denied'>('pending')
  const exploring = view === 'targeting' || view === 'goal-new'
  const following = !exploring && view !== 'account' && view !== 'templates' && view !== 'template-new'
  useEffect(() => {
    if (!session.isAuthenticated) { setChecked('pending'); return }
    const email = String(session.user?.email || '').toLowerCase()
    if (email) setChecked(ALLOWED.includes(email) ? 'ok' : 'denied')
  }, [session.isAuthenticated, session.user])
  useEffect(() => { if (session.isAuthenticated && view === 'login') navigate('targeting') }, [session.isAuthenticated, view, navigate])
  if (!session.isAuthenticated) return <LoginV2 navigate={navigate} />
  if (checked === 'denied') return <section className="farq-empty"><h1>هذا الحساب غير مصرح له</h1><Button onClick={() => void farqSession.signOut()}>تسجيل الخروج</Button></section>
  if (checked === 'pending') return <Loading />
  const tabs = [
    { label: 'استكشف', icon: 'map-pin' as const, active: exploring, onClick: () => navigate('targeting') },
    { label: 'متابعتي', icon: 'layers' as const, active: following, onClick: () => navigate('rfq-list') },
    { label: 'حسابي', icon: 'building' as const, active: view === 'account' || view === 'templates' || view === 'template-new', onClick: () => navigate('account') },
  ]
  return <>
    <a className="farq-skip-link" href="#farq-main">انتقل للمحتوى</a>
    <header className="farq-app-header"><button className="farq-brand-link" type="button" onClick={() => navigate('targeting')}><Brand /></button><nav className="farq-desktop-nav" aria-label="التنقل الرئيسي">{tabs.map(tab => <button key={tab.label} type="button" aria-current={tab.active ? 'page' : undefined} onClick={tab.onClick}><Icon name={tab.icon} size={18} />{tab.label}</button>)}</nav></header>
    <main id="farq-main" className={exploring ? 'farq-main-explore' : 'farq-main-work'} tabIndex={-1}>
      {following && view !== 'create-upload' && <nav className="farq-follow-nav" aria-label="أقسام متابعتي">{([{ label: 'طلبات الشراء', value: 'rfq-list' }, { label: 'فرص البيع', value: 'opportunities' }, { label: 'الوارد', value: 'inbox' }] as const).map(tab => <button type="button" key={tab.value} aria-current={view === tab.value ? 'page' : undefined} onClick={() => navigate(tab.value)}>{tab.label}</button>)}</nav>}
      <Suspense fallback={<Loading />}>
        {exploring && <Explore />}
        {view === 'create-upload' && <NewRequest navigate={navigate} />}
        {view === 'rfq-detail' && <Tracking navigate={navigate} />}
        {view === 'comparison' && <Comparison navigate={navigate} />}
        {view === 'award' && selectedRfqId && <Award rfqId={selectedRfqId} supplierId={new URLSearchParams(window.location.search).get('supplier')} onBack={() => navigate('comparison')} onDone={() => navigate('rfq-detail')} />}
        {view === 'inbox' && <Inbox onOpenRequest={id => { setSelectedRfqId(id); navigate('rfq-detail') }} />}
        {view === 'account' && <Account />}
        {view === 'opportunities' && <Opportunities />}
        {view === 'templates' && <Templates onBack={() => navigate('account')} onNew={() => navigate('template-new')} />}
        {view === 'template-new' && <TemplateEditor onBack={() => navigate('templates')} />}
        {(view === 'rfq-list' || view === 'login' || (view === 'award' && !selectedRfqId)) && <RfqList navigate={navigate} />}
      </Suspense>
    </main>
    <nav className="farq-mobile-nav" aria-label="التنقل الرئيسي">{tabs.map(tab => <button key={tab.label} type="button" aria-current={tab.active ? 'page' : undefined} onClick={tab.onClick}><Icon name={tab.icon} size={21} /><span>{tab.label}</span></button>)}</nav>
  </>
}
export default function App() {
  useEffect(() => { document.documentElement.dataset.farqApp = 'b2b'; return () => { delete document.documentElement.dataset.farqApp } }, [])
  return <ProcurementProvider><div className="farq-b2b" data-farq-b2b><Routes /></div></ProcurementProvider>
}
