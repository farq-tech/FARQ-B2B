import { useState } from 'react'
import { FarqGlassButton as Action } from '../ui/FarqGlassButton'
import { readLocal, writeLocal, type Opportunity } from './storage'
import { useProcurement } from '../procurementContext'

const STAGES = { potential: 'احتياج غير مؤكد', qualified: 'احتياج مؤكد يدويًا', quoted: 'عرض مُجهّز', won: 'تم الاتفاق يدويًا', closed: 'مغلقة' } as const
export default function Opportunities() {
  const { navigate } = useProcurement()
  const [rows, setRows] = useState(() => readLocal<Opportunity[]>('opportunities', []))
  const [active, setActive] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')
  const [notice, setNotice] = useState('')
  const [review, setReview] = useState(false)
  const chosen = rows.find(row => row.id === active)
  const save = (next: Opportunity[]) => {
    setRows(next); setNotice(writeLocal('opportunities', next) ? 'حُفظت التغييرات على هذا الجهاز.' : 'تعذّر الحفظ. اترك هذه الصفحة مفتوحة.')
  }
  const update = (patch: Partial<Opportunity>) => save(rows.map(row => row.id === active ? { ...row, ...patch, updatedAt: new Date().toISOString() } : row))
  const exportQuote = () => {
    if (!chosen) return
    const amount = Number(chosen.quote), qty = Number(chosen.quantity)
    const text = `FARQ B2B\nمسودة عرض سعر — لم تُرسل\nالجهة: ${chosen.company.name_ar || chosen.company.name_en}\nالمنتج: ${chosen.product}\nالاحتياج المؤكد يدويًا: ${chosen.need}\nالكمية: ${qty} ${chosen.unit}\nسعر الوحدة قبل الضريبة والتوصيل: ${amount} ر.س\nالإجمالي قبل الضريبة والتوصيل: ${amount * qty} ر.س\nيلزم استكمال الضريبة والتوصيل وصلاحية العرض قبل مشاركته.\n`
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = 'farq-quote-draft.txt'; link.click(); URL.revokeObjectURL(url)
    update({ stage: 'quoted' })
  }
  return <section className="farq-work-page"><div className="farq-work-heading"><div><h1>{chosen ? chosen.company.name_ar || chosen.company.name_en : 'فرص البيع'}</h1><p className="farq-muted">متابعة يدوية محفوظة على هذا الجهاز. لا تمثل رسائل مرسلة أو ردودًا من العملاء.</p></div><Action variant="secondary" showIcon={false} onClick={() => chosen ? (setActive(null), setReview(false)) : navigate('explore')}>{chosen ? 'كل الفرص' : 'استكشف مشترين'}</Action></div>
    <p role="status">{notice}</p>
    {!chosen ? <><label className="farq-filter">الحالة<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">كل الفرص</option>{Object.entries(STAGES).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label><div className="farq-opportunity-grid">{rows.filter(r => filter === 'all' || r.stage === filter).map(row => <button type="button" className="farq-entity" key={row.id} onClick={() => { setActive(row.id); setReview(false) }}><strong>{row.company.name_ar || row.company.name_en}</strong><p>{row.product}</p><span className="farq-pill">{STAGES[row.stage]}</span></button>)}</div>{!rows.length && <div className="farq-empty"><h2>ابدأ باختيار المشترين المحتملين</h2><p>تظهر هنا الفرص التي تحفظها من رحلة «أبي أبيع».</p><Action onClick={() => navigate('explore')}>استكشف الجهات</Action></div>}</> : <div className="farq-opportunity-detail"><div><h2>تأكيد الاحتياج</h2><label>ماذا أكد العميل؟<textarea value={chosen.need} onChange={e => update({ need: e.target.value })} placeholder="سجّل ما أكدته من العميل، لا نتيجة مطابقة النشاط" rows={3} /></label><div className="farq-inline-fields"><label>الكمية<input type="number" min="0.001" step="any" value={chosen.quantity} onChange={e => update({ quantity: e.target.value })} /></label><label>الوحدة<input value={chosen.unit} onChange={e => update({ unit: e.target.value })} /></label></div><Action disabled={!chosen.need.trim() || Number(chosen.quantity) <= 0 || !chosen.unit.trim()} onClick={() => update({ stage: 'qualified' })}>أكدت الاحتياج مع العميل</Action></div><div><h2>تجهيز عرض السعر</h2><label>سعر الوحدة قبل الضريبة والتوصيل<input type="number" min="0.01" step="0.01" value={chosen.quote} onChange={e => update({ quote: e.target.value })} /></label><p>الإجمالي قبل الضريبة والتوصيل: <bdi>{Number(chosen.quote) > 0 && Number(chosen.quantity) > 0 ? (Number(chosen.quote) * Number(chosen.quantity)).toLocaleString('en-US', { style: 'currency', currency: 'SAR' }) : '—'}</bdi></p><Action disabled={chosen.stage === 'potential' || !chosen.need.trim() || Number(chosen.quote) <= 0 || Number(chosen.quantity) <= 0 || !chosen.unit.trim()} onClick={() => setReview(true)}>راجع مسودة العرض</Action>{review && <div className="farq-review-summary"><h2>راجع قبل المشاركة</h2><p>{chosen.product} · {chosen.quantity} {chosen.unit}</p><p>هذه مسودة؛ أكمل الضريبة والتوصيل والصلاحية قبل إرسالها خارج المنصة.</p><Action onClick={exportQuote}>تحميل مسودة العرض</Action></div>}<div className="farq-secondary-actions"><Action variant="ghost" showIcon={false} onClick={() => update({ stage: 'closed' })}>إغلاق الفرصة</Action>{chosen.stage === 'quoted' && <Action variant="secondary" showIcon={false} onClick={() => update({ stage: 'won' })}>سجّل اتفاقًا أكدته مع العميل</Action>}</div></div></div>}
  </section>
}
