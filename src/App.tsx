import { useEffect, useState } from 'react'
import { ProcurementProvider, useProcurement } from './procurementContext'
import { useFarqSession } from './api/useFarqSession'
import { farqSession } from './api/farqSession'
import { LoginV2 } from './views/LoginV2'
import { RfqListV2 } from './views/RfqListV2'
import { RequestTrackingV2 } from './views/RequestTrackingV2'
import { ComparisonV2 } from './views/ComparisonV2'
import mark from './assets/pricing-v2/mark.svg'
import LiveBackground from './live-bg'

/*
 * «فرق تسعير» — owner-only. Two gates: the hosting server asks for the site
 * password before serving anything, and the app itself accepts only the
 * accounts listed in VITE_ALLOWED_EMAILS (default: the owner) after Farq login.
 */
const ALLOWED = String(import.meta.env.VITE_ALLOWED_EMAILS || 'abdulrhman@farq.sa').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean)

function Sidebar() {
  const { view, navigate } = useProcurement()
  const session = useFarqSession()
  const email = String(session.user?.email || '')
  const items: Array<[string, () => void, boolean]> = [
    ['طلبات التسعير', () => navigate('rfq-list'), view === 'rfq-list' || view === 'rfq-detail' || view === 'comparison'],
  ]
  return (
    <aside className="flex h-screen w-[264px] shrink-0 flex-col items-end gap-6 border-l bg-white px-4 py-6" style={{ borderColor: 'var(--color-border-default)' }}>
      <div className="flex items-center justify-end gap-2 px-2">
        <div className="flex items-baseline gap-1">
          <span className="text-[16px] leading-[26px]" style={{ color: 'var(--color-text-secondary)' }}>تسعير</span>
          <span className="font-[Readex_Pro] text-[20px] leading-[30px] font-semibold">فرق</span>
        </div>
        <img src={mark} alt="" width={32} height={32} />
      </div>
      <nav className="flex w-full flex-col gap-1">
        {items.map(([label, go, active]) => (
          <button key={label} type="button" onClick={go} className="flex h-11 w-full items-center justify-end rounded-[12px] px-3 text-[16px]" style={active ? { background: 'var(--color-bg-info)', color: 'var(--color-text-link)', fontWeight: 500 } : { color: 'var(--color-text-secondary)' }}>{label}</button>
        ))}
      </nav>
      <div className="flex-1" />
      <div className="flex w-full items-center justify-end gap-3 rounded-[12px] p-3" style={{ background: 'var(--color-bg-surface-2)' }}>
        <div className="flex min-w-0 flex-1 flex-col items-end text-right">
          <p className="truncate text-[14px] leading-[22px] font-medium">{email || '—'}</p>
          <button type="button" onClick={() => void farqSession.signOut()} className="text-[12px] leading-[18px]" style={{ color: 'var(--color-text-secondary)' }}>تسجيل الخروج</button>
        </div>
        <span className="flex size-9 items-center justify-center rounded-full text-[16px] font-medium" style={{ background: 'var(--color-bg-info)', color: 'var(--color-text-link)' }}>{(email[0] || 'ف').toUpperCase()}</span>
      </div>
    </aside>
  )
}

function Routes() {
  const { view, navigate } = useProcurement()
  const session = useFarqSession()
  const [checked, setChecked] = useState<'pending' | 'ok' | 'denied'>('pending')

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
        <button type="button" onClick={() => void farqSession.signOut()} className="rounded-[12px] px-6 py-3 text-white" style={{ background: 'var(--color-bg-cta)' }}>تسجيل الخروج</button>
      </div>
    )
  }
  if (checked === 'pending') return <div className="p-8 text-right" style={{ color: 'var(--color-text-secondary)' }}>جارٍ التحقق من الحساب…</div>
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1">
        {view === 'rfq-detail' && <RequestTrackingV2 navigate={navigate} />}
        {view === 'comparison' && <ComparisonV2 navigate={navigate} />}
        {view !== 'rfq-detail' && view !== 'comparison' && <RfqListV2 navigate={navigate} />}
      </main>
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
