import { useMemo, useRef, useState } from 'react'
import { Badge, Button, Icon, TopBar, useIsMobile } from '../../ui'
import { FOCUS_RING } from '../../ui/cx'
import { submitTemplate, TargetingError } from '../../api/targetingClient'
import { CATEGORY_LABEL, removeDraft, saveDraft, submitBlock, toMetaComponents, type HeaderKind, type TemplateCategory, type TemplateDraft } from './drafts'

/*
 * «08 · محرر قالب واتساب» — Figma 53:217. Writes a template the way Meta asks for it (name, language,
 * category, header, body with {{n}} variables and an example for each, footer, up to 3 quick replies)
 * with a live phone preview and the pre-submission checks.
 *
 * «أرسل للاعتماد» asks yes/no, then submits the template to Meta for review (POST /templates on the
 * targeting service). That sends no message to anyone. «احفظ مسودة» keeps the draft in this tab only (memory, nothing on the device).
 */

const BODY_MAX = 1024, HEADER_MAX = 60
const RISKY = ['مجاني', 'مجانا', 'مجانًا', 'عرض محدود', 'خصم', 'اربح']
const VAR_HINT = ['اسم المنشأة', 'نص الحملة']

const field = `w-full rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-3 text-[16px] leading-[26px] text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)] ${FOCUS_RING}`

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-1 rounded-[var(--radius-md)] bg-[var(--color-bg-surface-2)] p-1">
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={`rounded-[var(--radius-sm)] px-4 py-2 text-[14px] leading-[22px] font-medium ${value === v ? 'bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--elevation-sm)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'} ${FOCUS_RING}`}>{l}</button>
      ))}
    </div>
  )
}

const Label = ({ children, hint }: { children: string; hint?: string }) => (
  <span className="flex items-baseline gap-2 text-[14px] leading-[22px] font-medium">{children}{hint ? <span className="text-[12px] leading-[18px] font-normal text-[var(--color-text-tertiary)]">{hint}</span> : null}</span>
)

export default function TemplateEditor({ onBack }: { onBack: () => void }) {
  const mobile = useIsMobile()
  const [d, setD] = useState<Omit<TemplateDraft, 'savedAt'>>({
    name: '', label: '', language: 'ar', category: 'MARKETING', header: 'TEXT', headerText: '', body: 'السلام عليكم {{1}}،\n{{2}}', examples: { '1': 'مؤسسة الخليج للمقاولات', '2': 'اكتشف فرق وقارن عروض الأسعار في مكان واحد.' }, footer: 'للإيقاف أرسل: إيقاف', buttons: [{ text: 'مهتم', kind: 'QUICK_REPLY' }, { text: 'إيقاف الرسائل', kind: 'OPT_OUT' }],
  })
  const [saved, setSaved] = useState<string | null>(null)
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const [asking, setAsking] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const body = useRef<HTMLTextAreaElement>(null)
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => { setD((x) => ({ ...x, [k]: v })); setSaved(null) }

  const vars = useMemo(() => [...new Set([...d.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]))].sort((a, b) => +a - +b), [d.body])
  const nameOk = /^[a-z0-9_]{1,512}$/.test(d.name)
  const hasCampaignVariables = vars.join(',') === '1,2'
  const checks = [
    { ok: /إيقاف|stop/i.test(`${d.footer} ${d.body} ${d.buttons.map((b) => b.text).join(' ')}`), label: 'فيه خيار إيقاف واضح' },
    { ok: hasCampaignVariables && vars.every((v) => (d.examples[v] || '').trim()), label: hasCampaignVariables ? 'للقالب متغيران فقط: اسم المنشأة ونص الحملة' : 'استخدم المتغيرين {{1}} و{{2}} فقط' },
    { ok: d.category !== 'AUTHENTICATION', label: 'الفئة مناسبة لنوع الرسالة' },
    { ok: !RISKY.some((w) => `${d.headerText} ${d.body}`.includes(w)), label: 'تجنّب كلمات مثل «مجاني» و«عرض محدود» — ترفع احتمال الرفض' },
  ]
  const fill = (s: string) => s.replace(/\{\{(\d+)\}\}/g, (_, n) => d.examples[n] || `{{${n}}}`)
  const bold = () => {
    const el = body.current
    if (!el) return
    const a = el.selectionStart, b = el.selectionEnd
    set('body', (d.body.slice(0, a) + '*' + d.body.slice(a, b) + '*' + d.body.slice(b)).slice(0, BODY_MAX))
  }
  const canSave = nameOk && d.body.trim().length > 0
  const save = () => {
    if (!canSave) return
    setSaved(saveDraft({ ...d, savedAt: new Date().toISOString() }) ? 'انحفظت المسودة في هذه الصفحة (تنمسح إذا حدّثتها).' : 'ما قدرنا نحفظ المسودة.')
  }

  const preview = (
    <aside aria-label="معاينة" className="flex flex-col gap-3 rounded-[28px] bg-[var(--color-bg-inverse)] p-4 text-[var(--color-text-on-inverse)]">
      <div className="flex items-center justify-between text-[14px] leading-[22px] font-medium"><span className="flex items-center gap-2"><Icon name="phone" size={16} />Farq B2B</span><span className="text-[12px] text-[var(--color-text-on-inverse-secondary)]">معاينة</span></div>
      <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] bg-[var(--color-bg-surface)] p-4 text-[var(--color-text-primary)]">
        {d.header === 'TEXT' && d.headerText ? <p className="text-[16px] leading-[26px] font-semibold">{d.headerText}</p> : d.header !== 'NONE' && d.header !== 'TEXT' ? <p className="rounded-[var(--radius-md)] bg-[var(--color-bg-surface-2)] px-3 py-6 text-center text-[12px] text-[var(--color-text-tertiary)]">{d.header === 'IMAGE' ? 'صورة' : 'ملف'}</p> : null}
        <p className="text-[15px] leading-[24px] whitespace-pre-line">{fill(d.body) || <span className="text-[var(--color-text-tertiary)]">نص الرسالة يظهر هنا</span>}</p>
        {d.footer ? <p className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">{d.footer}</p> : null}
      </div>
      {d.buttons.filter((b) => b.text.trim()).map((b, i) => (
        <span key={i} className="rounded-[var(--radius-md)] bg-[var(--color-bg-surface)] py-2.5 text-center text-[15px] leading-[24px] font-medium text-[var(--color-text-info)]">{b.text}</span>
      ))}
    </aside>
  )

  const checklist = (
    <section aria-labelledby="checks" className="flex flex-col gap-3 rounded-[var(--radius-xl)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-5">
      <h2 id="checks" className="font-[family-name:var(--font-display)] text-[18px] leading-[28px] font-semibold">قبل الإرسال للاعتماد</h2>
      <ul className="flex flex-col gap-2">
        {checks.map((c) => (
          <li key={c.label} className={`flex items-start gap-2 text-[14px] leading-[22px] ${c.ok ? '' : 'text-[var(--color-text-warning)]'}`}>
            <Icon name={c.ok ? 'check' : 'alert'} size={18} className={`mt-0.5 shrink-0 ${c.ok ? 'text-[var(--color-icon-success)]' : ''}`} />{c.label}
          </li>
        ))}
      </ul>
    </section>
  )

  const formRef = useRef<HTMLFormElement>(null)
  const block = submitBlock(d)
  async function submit() {
    setSubmitting(true); setResult(null)
    try {
      const r = await submitTemplate({ name: d.name, language: d.language, category: d.category, components: toMetaComponents(d) })
      if (r.ok) { removeDraft(d.name); setResult({ ok: true, text: `وصل القالب لـMeta${r.status ? ` — الحالة: ${r.status === 'APPROVED' ? 'معتمد' : r.status === 'PENDING' ? 'قيد المراجعة' : r.status === 'REJECTED' ? 'مرفوض' : r.status}` : ''}. تشوف حالته في «قوالب واتساب».` }) }
      else setResult({ ok: false, text: `ما قبلته Meta: ${r.error || 'خطأ غير معروف'}` })
    } catch (e) {
      setResult({ ok: false, text: e instanceof TargetingError ? e.message : 'تعذّر الإرسال لـMeta. حاول بعد شوي.' })
    } finally { setSubmitting(false); setAsking(false) }
  }
  const resultBox = result ? <p role={result.ok ? 'status' : 'alert'} className={`rounded-[var(--radius-md)] px-3 py-2 text-[14px] leading-[22px] ${result.ok ? 'bg-[var(--color-bg-success)] text-[var(--color-text-success)]' : 'bg-[var(--color-bg-danger)] text-[var(--color-text-danger)]'}`}>{result.text}</p> : null
  const confirmBox = asking ? (
    <div className={`fixed inset-0 z-[60] flex justify-center bg-[var(--color-bg-inverse)]/40 ${mobile ? 'items-end' : 'items-center p-4'}`} role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !submitting) setAsking(false) }}>
      <div role="dialog" aria-modal="true" aria-labelledby="tpl-confirm" className={`flex w-full flex-col gap-4 bg-[var(--color-bg-surface)] px-6 pt-5 pb-6 shadow-[var(--elevation-lg)] ${mobile ? 'rounded-t-[var(--radius-xl)]' : 'max-w-[480px] rounded-[var(--radius-xl)]'}`}>
        <h2 id="tpl-confirm" className="font-[family-name:var(--font-display)] text-[22px] leading-[32px] font-semibold">نرسل القالب لـMeta للاعتماد؟</h2>
        <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">يروح القالب لحساب واتساب للأعمال حق فرق للمراجعة. ما تنرسل أي رسالة لأي مورد.</p>
        <dl className="flex flex-col gap-2 rounded-[var(--radius-lg)] bg-[var(--color-bg-surface-2)] p-4 text-[14px] leading-[22px]">
          <div className="flex justify-between gap-3"><dt className="text-[var(--color-text-secondary)]">الاسم</dt><dd><bdi>{d.name}</bdi></dd></div>
          <div className="flex justify-between gap-3"><dt className="text-[var(--color-text-secondary)]">الفئة · اللغة</dt><dd>{CATEGORY_LABEL[d.category]} · {d.language === 'ar' ? 'العربية' : 'English'}</dd></div>
        </dl>
        <p className="rounded-[var(--radius-lg)] border border-[var(--color-border-default)] p-3 text-[14px] leading-[22px] whitespace-pre-line">{d.body}</p>
        <div className="flex gap-3">
          <div className="min-w-0 flex-1"><Button variant="Primary" size="L" fullWidth loading={submitting} loadingLabel="جارٍ الإرسال لـMeta…" disabled={submitting} onClick={() => void submit()}>نعم، أرسل للاعتماد</Button></div>
          <Button variant="Secondary" size="L" disabled={submitting} onClick={() => setAsking(false)}>لا</Button>
        </div>
      </div>
    </div>
  ) : null
  const FORM = (
          <form ref={formRef} onSubmit={(e) => { e.preventDefault(); save() }} className="flex flex-col gap-6 rounded-[var(--radius-xl)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-6">
            <div className={mobile ? 'flex flex-col gap-4' : 'grid grid-cols-2 gap-4'}>
              <label className="flex flex-col gap-2">
                <Label>اسم القالب</Label>
                <input dir="ltr" value={d.name} onChange={(e) => set('name', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} placeholder="supplier_invite_plumbing" className={`${field} text-end`} aria-invalid={Boolean(d.name) && !nameOk} />
                <span className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">حروف إنجليزية صغيرة وشرطة سفلية — ما يظهر للمستلم</span>
              </label>
              <label className="flex flex-col gap-2">
                <Label>اللغة</Label>
                <select value={d.language} onChange={(e) => set('language', e.target.value as 'ar' | 'en')} className={field}><option value="ar">العربية</option><option value="en">English</option></select>
              </label>
            </div>
            <label className="flex flex-col gap-2">
              <Label hint="(يظهر لك أنت في القائمة)">الاسم بالعربي</Label>
              <input value={d.label} onChange={(e) => set('label', e.target.value.slice(0, 80))} placeholder="دعوة موردي السباكة" className={field} />
            </label>
            <div className="flex flex-col gap-2">
              <Label>الفئة</Label>
              <Segmented label="الفئة" value={d.category} onChange={(v: TemplateCategory) => set('category', v)} options={[['MARKETING', CATEGORY_LABEL.MARKETING], ['UTILITY', CATEGORY_LABEL.UTILITY], ['AUTHENTICATION', CATEGORY_LABEL.AUTHENTICATION]]} />
              <span className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">رسائل الدعوة والعروض = تسويق. تحديثات طلب قائم = خدمة (أرخص وأسرع اعتماد).</span>
            </div>
            <div className="flex flex-col gap-2">
              <Label hint="(اختياري)">الرأس</Label>
              <Segmented label="الرأس" value={d.header} onChange={(v: HeaderKind) => set('header', v)} options={[['NONE', 'بدون'], ['TEXT', 'نص'], ['IMAGE', 'صورة'], ['DOCUMENT', 'ملف']]} />
            </div>
            {d.header === 'TEXT' ? (
              <label className="flex flex-col gap-2">
                <Label>نص الرأس</Label>
                <input value={d.headerText} maxLength={HEADER_MAX} onChange={(e) => set('headerText', e.target.value)} placeholder="طلبات تسعير جديدة في الرياض" className={field} />
                <span className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)] tabular-nums">{d.headerText.length} / {HEADER_MAX}</span>
              </label>
            ) : null}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label>نص الرسالة</Label>
                <div className="flex gap-2">
                  <Button variant="Secondary" size="S" onClick={bold}>غامق</Button>
                </div>
              </div>
              <textarea ref={body} value={d.body} maxLength={BODY_MAX} rows={5} onChange={(e) => set('body', e.target.value)} aria-label="نص الرسالة"
                placeholder={'هلا {{1}}،\n{{2}}'} className={`${field} min-h-[120px] resize-y border-2 border-[var(--color-border-primary)]`} />
              <span className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)] tabular-nums">{d.body.length} / {BODY_MAX}</span>
            </div>
            {vars.length ? (
              <div className="flex flex-col gap-2">
                <Label hint="(هذه هي القيم الوحيدة التي تتبدل عند الإرسال)">المتغيرات وأمثلتها</Label>
                {vars.map((v) => (
                  <label key={v} className="flex items-center gap-3 rounded-[var(--radius-md)] bg-[var(--color-bg-surface-2)] px-4 py-2">
                    <span dir="ltr" className="shrink-0 font-medium text-[var(--color-text-info)]">{`{{${v}}}`}</span>
                    <span className="shrink-0 text-[14px] text-[var(--color-text-tertiary)]">{VAR_HINT[+v - 1] || `متغير ${v}`}</span>
                    <input value={d.examples[v] || ''} onChange={(e) => set('examples', { ...d.examples, [v]: e.target.value.slice(0, 120) })} placeholder="مثال" aria-label={`مثال المتغير ${v}`} className={`min-w-0 flex-1 bg-transparent py-1 text-[14px] outline-none ${FOCUS_RING}`} />
                  </label>
                ))}
              </div>
            ) : null}
            <label className="flex flex-col gap-2">
              <Label>التذييل</Label>
              <input value={d.footer} maxLength={60} onChange={(e) => set('footer', e.target.value)} className={field} />
              <span className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">نضيف خيار الإيقاف تلقائيًا في القوالب التسويقية — يحمي رقمك من الحظر.</span>
            </label>
            <div className="flex flex-col gap-2">
              <Label hint="حتى 3 ردود سريعة">الأزرار</Label>
              {d.buttons.map((b, i) => (
                <div key={i} className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border-default)] px-4 py-2">
                  <input value={b.text} maxLength={25} onChange={(e) => set('buttons', d.buttons.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} aria-label={`نص الزر ${i + 1}`} className={`min-w-0 flex-1 bg-transparent py-1 text-[16px] outline-none ${FOCUS_RING}`} />
                  <Badge tone="Neutral" showDot={false} label={b.kind === 'OPT_OUT' ? 'إلغاء اشتراك' : 'رد سريع'} className="text-[12px] leading-[18px]" />
                  <button type="button" aria-label={`حذف الزر ${b.text || i + 1}`} onClick={() => set('buttons', d.buttons.filter((_, j) => j !== i))} className={`text-[var(--color-icon-secondary)] hover:text-[var(--color-text-primary)] ${FOCUS_RING}`}><Icon name="x" size={16} /></button>
                </div>
              ))}
              {d.buttons.length < 3 ? (
                <button type="button" onClick={() => set('buttons', [...d.buttons, { text: '', kind: 'QUICK_REPLY' }])} className={`flex items-center gap-1 self-start text-[14px] leading-[22px] font-medium text-[var(--color-text-info)] ${FOCUS_RING}`}><Icon name="plus" size={16} />أضف زر</button>
              ) : null}
            </div>
          </form>
  )
  if (mobile) {
    return (
      <div className="flex min-w-0 flex-col pb-[96px]">
        <TopBar parent="قوالب واتساب" onParent={onBack} title={d.label || 'قالب جديد'} />
        <div className="flex flex-col gap-4 px-4 py-4">
          <div role="tablist" aria-label="القالب" className="grid grid-cols-2 gap-1 rounded-[var(--radius-md)] bg-[var(--color-bg-surface-2)] p-1">
            {([['preview', 'المعاينة'], ['edit', 'التحرير']] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`rounded-[var(--radius-sm)] py-2 text-[16px] leading-[26px] font-medium ${tab === k ? 'bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--elevation-sm)]' : 'text-[var(--color-text-secondary)]'} ${FOCUS_RING}`}>{l}</button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Badge tone="Neutral" label="مسودة" className="text-[12px] leading-[18px]" />
            <span className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{CATEGORY_LABEL[d.category]} · {d.language === 'ar' ? 'العربية' : 'English'}</span>
          </div>
          {saved ? <p role="status" className="rounded-[var(--radius-md)] bg-[var(--color-bg-success)] px-3 py-2 text-[14px] leading-[22px] text-[var(--color-text-success)]">{saved}</p> : null}
          {resultBox}
          {block && tab === 'edit' ? <p className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">قبل «أرسل للاعتماد»: {block}</p> : null}
          {confirmBox}
          {tab === 'preview' ? (
            <>
              {preview}
              <p className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">القوالب لازم تعتمدها Meta قبل أول إرسال — عادةً خلال دقائق.</p>
              {checklist}
            </>
          ) : FORM}
        </div>
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
          {tab === 'preview'
            ? <Button variant="Secondary" size="L" icon="edit" fullWidth onClick={() => setTab('edit')}>عدّل القالب</Button>
            : <div className="flex gap-3"><div className="min-w-0 flex-1"><Button variant="Primary" size="L" icon="send" fullWidth disabled={Boolean(block)} onClick={() => setAsking(true)}>أرسل للاعتماد</Button></div><Button variant="Secondary" size="L" disabled={!canSave} onClick={save}>مسودة</Button></div>}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col">
      <TopBar parent="قوالب واتساب" onParent={onBack} title="قالب جديد" />
      <div className={mobile ? 'flex flex-col gap-4 px-4 py-5' : 'flex flex-col gap-6 px-8 py-8'}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <h1 className="font-[family-name:var(--font-display)] text-[32px] leading-[44px] font-semibold">{d.label || 'قالب جديد'}</h1>
              <Badge tone="Neutral" label="مسودة" />
            </div>
            <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">القوالب لازم تعتمدها Meta قبل أول إرسال — غالبًا خلال دقائق، وأحيانًا تاخذ لين 24 ساعة.</p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="Secondary" size="L" disabled={!canSave} onClick={save}>احفظ مسودة</Button>
            <Button variant="Primary" size="L" icon="send" disabled={Boolean(block)} title={block || undefined} onClick={() => setAsking(true)}>أرسل للاعتماد</Button>
          </div>
        </div>
        {saved ? <p role="status" className="rounded-[var(--radius-md)] bg-[var(--color-bg-success)] px-3 py-2 text-[14px] leading-[22px] text-[var(--color-text-success)]">{saved}</p> : null}
        {resultBox}
        {block ? <p className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-bg-surface-2)] px-3 py-2 text-[14px] leading-[22px] text-[var(--color-text-secondary)]"><Icon name="info" size={18} />قبل «أرسل للاعتماد»: {block}</p> : null}
        {confirmBox}

        <div className={mobile ? 'flex flex-col gap-4' : 'grid grid-cols-[minmax(0,1fr)_330px] items-start gap-6'}>
          {FORM}
          <div className="flex flex-col gap-4">{preview}{checklist}</div>
        </div>
      </div>
    </div>
  )
}
