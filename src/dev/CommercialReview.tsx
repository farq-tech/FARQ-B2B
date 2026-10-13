import { useRef, useState } from 'react'
import { Button, Logo } from '../ui'
import { discoverCommercial, type Direction, type DiscoveryResult, type DiscoveryRow } from '../api/commercialIntelligence'

function ResultCard({ row }: { row: DiscoveryRow }) {
  return <article className="rounded-2xl border bg-white p-5">
    <h3 className="text-xl font-semibold">{row.name}</h3>
    {row.level && row.match_status !== 'ACTIVITY_MATCH' && <p className="mt-2 text-sm">مستوى الترشيح: {row.level} · درجة ترتيب تجريبية: {row.score}</p>}
    {row.commercial_identity && <p className="mt-2 text-sm">الهوية التجارية: {row.commercial_identity.display_name} · الدور يتحدد لهذا الهدف فقط</p>}
    {row.commercial_relationship && <p className="mt-2 text-sm">{row.commercial_relationship.current_demand ? 'طلب حالي منشور؛ المواصفات والأهلية تحتاج مراجعة' : row.commercial_relationship.evidence_state === 'SOURCE_PRODUCT_OR_FAMILY_EVIDENCE' ? 'دليل بيع محفوظ لصنف أو عائلة؛ المخزون غير مؤكد' : row.commercial_relationship.evidence_state === 'HISTORICAL_SOURCE_NOT_CURRENT' ? 'دليل تاريخي؛ ليس طلبًا حاليًا' : row.commercial_relationship.role === 'organization' ? 'نشاط ذو صلة؛ دور البيع والشراء غير محدد' : row.commercial_relationship.role === 'buyer' ? 'مشتري محتمل بحسب الاستخدام؛ لا طلب شراء حالي مثبت' : row.commercial_relationship.role === 'partner' ? 'شريك محتمل؛ اهتمامه بالشراكة غير مؤكد' : 'بائع محتمل بحسب التخصص؛ الصنف والمخزون غير مثبتين'}</p>}
    {row.reachability && <p className="mt-2 text-sm">التواصل المسجل: {row.reachability.channel_presence.join(' · ') || 'لا توجد وسيلة مسجلة'} · {row.reachability.needs_enrichment ? 'يحتاج استكمالًا' : 'التحقق الحي غير مكتمل'}</p>}
    {row.subject && <p className="mt-2">{row.subject}</p>}
    <p className="mt-2">{row.reason}</p>
    <p className="mt-2 text-sm">{[row.city, row.district].filter(Boolean).join(' · ')}</p>
    <p className="mt-2 text-sm">{row.verification_dimension ? 'نشر الطلب موثق؛ توافق عرضك ومتطلبات المشاركة يحتاجان مراجعة' : row.verified ? 'دليل مستوفٍ لشروط التحقق المحددة' : 'مرشح يحتاج مراجعة الدليل والهوية'}</p>
    {row.observed_at && <p className="mt-2 text-sm">تاريخ الدليل المحفوظ: {row.observed_at.slice(0, 10)}</p>}
    {row.source_url?.startsWith('https://') && <a href={row.source_url} target="_blank" rel="noreferrer" className="mt-3 inline-block underline">عرض مصدر الدليل</a>}
  </article>
}

export default function CommercialReview() {
  const [direction, setDirection] = useState<Direction>('purchase')
  const [platform, setPlatform] = useState<'pricing' | 'construction'>('pricing')
  const [text, setText] = useState('أحتاج 20 كرسي انتظار لعيادة بالرياض')
  const [city, setCity] = useState('الرياض')
  const [result, setResult] = useState<DiscoveryResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  const lastQuery = useRef({ text, direction, city, platform })
  async function search(append = false) {
    controller.current?.abort(); controller.current = new AbortController()
    setBusy(true); setError(''); if (!append) { setResult(null); lastQuery.current = { text, direction, city, platform } }
    const query = lastQuery.current
    try {
      const page = await discoverCommercial(query.text, query.direction, query.city, query.platform, controller.current.signal, append ? result?.next_offset ?? 0 : 0)
      setResult(previous => append && previous ? { ...page, direct: [...previous.direct, ...page.direct], main: [...previous.direct, ...page.direct] } : page)
    }
    catch (e) { if ((e as Error).name !== 'AbortError') setError((e as Error).message) }
    finally { setBusy(false) }
  }
  return <main dir="rtl" className="mx-auto max-w-5xl space-y-6 p-6">
    <Logo />
    <h1 className="text-3xl font-bold">وش هدف منشأتك؟</h1>
    <div className="flex flex-wrap gap-4">
      <label>هدفك <select value={direction} onChange={e => setDirection(e.target.value as Direction)} className="rounded-lg border p-3">
        <option value="purchase">أبي أشتري — أبحث عن بائعين</option><option value="marketing">أبي أبيع — أبحث عن مشترين</option>
        <option value="activity">أبحث عن نشاط أو تخصص محدد</option><option value="availability">أستفسر عن التوفر</option><option value="partnership">أبحث عن شركاء</option>
      </select></label>
      <label>المسار <select value={platform} onChange={e => setPlatform(e.target.value as 'pricing' | 'construction')} className="rounded-lg border p-3"><option value="pricing">فرق تسعير</option><option value="construction">فرق بناء</option></select></label>
      <label>المدينة <input className="rounded-lg border p-3" value={city} onChange={e => setCity(e.target.value)} /></label>
    </div>
    <label className="block">{direction === 'activity' ? 'وش النشاط اللي تستهدفه؟' : direction === 'marketing' ? 'وش تبي تسوّق؟' : 'وش تحتاج؟'}
      <textarea className="mt-2 block min-h-32 w-full rounded-2xl border p-4" maxLength={1000} value={text} onChange={e => setText(e.target.value)} />
    </label>
    <Button variant="Primary" size="L" disabled={busy || text.trim().length < 2} onClick={() => void search()}>{busy ? 'نبحث في الأدلة…' : direction === 'activity' ? 'ابحث عن النشاط' : direction === 'marketing' ? 'ابحث عن مشترين' : direction === 'partnership' ? 'ابحث عن شركاء' : direction === 'availability' ? 'استفسر عن التوفر' : 'ابحث عن بائعين'}</Button>
    <p>تجربة مراجعة محلية؛ لا تنشئ طلبًا ولا ترسل رسائل.</p>
    {error && <p role="alert">{error}</p>}
    {result && <div aria-live="polite" className="space-y-5">
      <h2 className="text-2xl font-semibold">{result.search_mode === 'activity' ? 'المنشآت المطابقة للنشاط' : result.policy === 'PRAGMATIC' ? 'النتائج الرئيسية A وB' : 'الجهات ذات الأدلة المستوفية'} ({result.direct.length})</h2>
      {result.search_mode === 'activity' && <p>إجمالي المطابقات المتاحة: {result.total} · المعروض: {result.direct.length}</p>}
      {result.direct.map(row => <ResultCard row={row} key={row.id} />)}
      {result.search_mode === 'activity' && result.next_offset != null && <Button variant="Primary" size="L" disabled={busy} onClick={() => void search(true)}>عرض المزيد من النتائج</Button>}
      <h2 className="text-2xl font-semibold">مرشحون للمراجعة {result.policy === 'PRAGMATIC' ? 'C وD' : ''} ({result.potential.length})</h2>
      {result.potential.map(row => <ResultCard row={row} key={row.id} />)}
      {result.direct.length === 0 && result.potential.length === 0 && <p>لم نجد جهة تستوفي الأدلة المطلوبة في البيانات المتاحة.</p>}
      {(result.catalogue_evidence?.length ?? 0) > 0 && <><h2 className="text-2xl font-semibold">مراجع منتجات تحتاج ربطًا بجهة</h2>{result.catalogue_evidence!.map(row => <ResultCard row={row} key={row.id} />)}</>}
    </div>}
  </main>
}
