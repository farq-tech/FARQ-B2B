import { useRef, useState } from 'react'
import { Button, Logo } from '../ui'
import { discoverCommercial, type Direction, type DiscoveryResult, type DiscoveryRow } from '../api/commercialIntelligence'

const functionLabels: Record<string, string> = { seller: 'بائع محتمل', manufacturer: 'مصنّع بحسب المصدر', distributor: 'موزّع بحسب المصدر', service_provider: 'مقدم خدمة محتمل', user_potential: 'مستخدم أو مشترٍ محتمل', regulator: 'جهة تنظيمية', educational_research: 'تعليم أو بحث', publisher_information: 'ناشر معلومات', marketplace_intermediary: 'وسيط أو سوق إلكتروني', partner_potential: 'شريك محتمل' }

const activityLabels: Record<string, string> = { software: 'برمجيات', computer_trade: 'تجارة أجهزة كمبيوتر', computer_repair: 'صيانة كمبيوتر', accounting: 'محاسبة', legal: 'خدمات قانونية', medical_care: 'رعاية صحية', medical_trade: 'تجارة مستلزمات طبية', dental: 'طب أسنان', pharmacy: 'صيدلة', food_service: 'مطاعم ومقاهٍ', retail_food: 'غذاء وبقالة', plumbing_trade: 'تجارة سباكة', plumbing_service: 'خدمات سباكة', construction: 'مقاولات', engineering: 'استشارات هندسية', logistics: 'شحن ولوجستيات', uniforms: 'زي موحد', textiles: 'أقمشة', education: 'تعليم وبحث', training: 'تدريب', agriculture: 'زراعة', coffee_trade: 'تجارة قهوة', office: 'أعمال مكتبية', hotel: 'ضيافة', general_retail: 'تجارة عامة', auto_service: 'خدمات سيارات', auto_trade: 'قطع غيار', beauty: 'عناية شخصية', marketing: 'تسويق', hvac: 'تكييف وتبريد', printing: 'طباعة', insurance: 'تأمين', telecom: 'اتصالات', security: 'أمن وحراسة', waste: 'نفايات وتدوير', tourism: 'سفر وسياحة', clothing_retail: 'تجارة ملابس', stationery: 'قرطاسية', industrial: 'صناعة', furniture: 'أثاث', hr: 'موارد بشرية', nonprofit: 'قطاع غير ربحي', government: 'قطاع حكومي' }

function exclusionLabel(reason: string | string[]) {
  const value = Array.isArray(reason) ? reason.join(' ') : reason
  if (/REGULATOR|NONCOMMERCIAL/.test(value)) return 'جهة تنظيمية أو معلوماتية؛ لا دليل بيع مناسب'
  if (/REPAIR|MAINTENANCE/.test(value)) return 'خدمة صيانة لا تطابق المنتج المطلوب'
  if (/COFFEE/.test(value)) return 'تشابه لفظي لا يدل على حبوب القهوة'
  if (/MANUFACTUR|UNIFORM/.test(value)) return 'لم يثبت تخصص التصنيع المطلوب'
  if (/CONFLICT|COMPATIBLE/.test(value)) return 'تعارض في النشاط أو عدم توافقه مع الهدف'
  return 'الدليل لا يدعم المنتج أو الخدمة المطلوبة'
}

function ResultCard({ row }: { row: DiscoveryRow }) {
  return <article className="rounded-2xl border bg-white p-5">
    <h3 className="text-xl font-semibold">{row.display_identity?.display_name || row.name}</h3>
    {row.display_identity?.branch_label && <p className="mt-1 text-sm">{row.display_identity.branch_label}</p>}
    {row.commercial_source_title && <p className="mt-1 text-sm">الدليل: {row.commercial_source_title}</p>}
    {row.commercial_group && <details className="mt-3 rounded-lg border p-3"><summary>استعراض المواقع والفروع المسجلة ({row.commercial_group.source_record_count} سجل) · {row.commercial_group.source_locality_count} تسميات أحياء</summary><p className="mt-2 text-sm">تجميع للعرض حسب هذا الهدف؛ الملكية القانونية وعدد الفروع الفعلي غير مثبتين؛ الحي نفسه قد يضم أكثر من فرع. وسائل التواصل تخص كل سجل.</p><ul className="mt-3 space-y-3">{row.commercial_group.branches.map(branch => <li key={`${branch.id}-${branch.source_ref}`}><p>{branch.name} · {[branch.city, branch.district].filter(Boolean).join(' · ') || 'الموقع غير محسوم'}</p><p className="text-sm">التواصل المسجل: {branch.contact_channels.join(' · ') || 'غير متوفر'} · مرجع المصدر: {branch.source_ref || 'صفحة محفوظة'}</p>{branch.source_url?.startsWith('https://') && <a href={branch.source_url} target="_blank" rel="noreferrer" className="underline">مصدر الفرع</a>}</li>)}</ul></details>}
    {row.level && row.match_status !== 'ACTIVITY_MATCH' && <p className="mt-2 text-sm">مستوى الترشيح: {row.level} · درجة ترتيب تجريبية: {row.score}</p>}
    {row.commercial_identity && <p className="mt-2 text-sm">الهوية التجارية: {row.commercial_identity.display_name} · الدور يتحدد لهذا الهدف فقط</p>}
    {row.commercial_relationship && <p className="mt-2 text-sm">{row.commercial_relationship.current_demand ? 'طلب حالي منشور؛ المواصفات والأهلية تحتاج مراجعة' : row.commercial_relationship.evidence_state === 'SOURCE_PRODUCT_OR_FAMILY_EVIDENCE' ? 'دليل بيع محفوظ لصنف أو عائلة؛ المخزون غير مؤكد' : row.commercial_relationship.evidence_state === 'HISTORICAL_SOURCE_NOT_CURRENT' ? 'دليل تاريخي؛ ليس طلبًا حاليًا' : row.commercial_relationship.role === 'organization' ? 'نشاط ذو صلة؛ دور البيع والشراء غير محدد' : row.commercial_relationship.role === 'buyer' ? 'مشتري محتمل بحسب الاستخدام؛ لا طلب شراء حالي مثبت' : row.commercial_relationship.role === 'partner' ? 'شريك محتمل؛ اهتمامه بالشراكة غير مؤكد' : 'بائع محتمل بحسب التخصص؛ الصنف والمخزون غير مثبتين'}</p>}
    {row.reachability && <p className="mt-2 text-sm">التواصل المسجل: {row.reachability.channel_presence.join(' · ') || 'لا توجد وسيلة مسجلة'} · {row.reachability.needs_enrichment ? 'يحتاج استكمالًا' : 'التحقق الحي غير مكتمل'}</p>}
    {row.commercial_function && <p className="mt-2 text-sm">العلاقة: {functionLabels[row.commercial_function] || row.commercial_function}</p>}
    {(row.unified_activity || row.activity_assessment) && <p className="mt-2 text-sm">النشاط المرجح: {activityLabels[(row.unified_activity || row.activity_assessment)?.primary_activity || ''] || 'نشاط عام أو غير محسوم'} · التعارضات: {(row.unified_activity || row.activity_assessment)?.conflicts.length} · ترجيح آلي، لا إثبات قانوني</p>}
    {row.commercial_value && <div className="mt-3 rounded-lg bg-emerald-50 p-3"><p>لماذا يناسب هدفك؟</p><p className="text-sm">{row.commercial_value.relationship_type === 'POTENTIAL_RESALE_BUYER' ? 'مشتري محتمل لإعادة البيع' : row.commercial_value.relationship_type === 'POTENTIAL_PROJECT_USER' ? 'استخدام محتمل ضمن المشاريع' : row.commercial_value.relationship_type === 'POTENTIAL_BUSINESS_USER' ? 'استخدام محتمل في نشاط المنشأة' : 'توريد أو تقديم خدمة محتمل'}</p><ul>{row.commercial_value.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul><p className="text-sm">قدرة التعامل بالكمية المطلوبة غير مؤكدة. {row.commercial_value.procurement_scope === 'CENTRAL_OFFICE_SOURCE_SIGNAL' ? 'المصدر يشير لمقر مركزي؛ مسؤول المشتريات غير مؤكد.' : 'السجل المحلي لا يثبت صلاحية مشتريات مركزية.'}</p></div>}
    {row.reachability?.actual_values_available && <p className="mt-2 text-sm" dir="ltr">{[...(row.reachability.source_contacts?.phone || []), ...(row.reachability.source_contacts?.email || [])].join(' · ')}</p>}
    {row.usage_reason && <p className="mt-2 text-sm">سبب الاستخدام المحتمل: {row.usage_reason}</p>}
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
      {(result.excluded?.length ?? 0) > 0 && <details><summary>مستبعدون بسبب تعارض أو عدم ملاءمة ({result.excluded_count ?? result.excluded?.length})</summary><ul>{result.excluded!.slice(0, 20).map((row, index) => <li key={`${row.subject_id || row.name}-${index}`}>{row.name || 'سجل منتج'} · {exclusionLabel(row.reason)}</li>)}</ul></details>}
      {(result.catalogue_evidence?.length ?? 0) > 0 && <><h2 className="text-2xl font-semibold">مراجع منتجات تحتاج ربطًا بجهة</h2>{result.catalogue_evidence!.map(row => <ResultCard row={row} key={row.id} />)}</>}
    </div>}
  </main>
}
