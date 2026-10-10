import { useEffect, useRef, useState } from 'react'
import { Badge, ChannelBadge, type BadgeTone, type Channel } from '../../../ui/Badge'
import { Icon, type IconName } from '../../../ui/Icon'
import { Logo } from '../../../ui/Logo'
import { cx, FOCUS_RING } from '../../../ui/cx'
import { EMAIL, EMAIL_HREF, ENTERPRISE_EMAIL_HREF, WHATSAPP_HREF, WHATSAPP_NUMBER_DISPLAY } from '../contact'
import { Container, DEEP_FOCUS, LinkButton, T, TextLink } from '../kit'
import Shayeb, { type ShayebDir } from './Shayeb'

/*
 * Everything below the hero (one lazy chunk) — owner brief 2026-10-10 §5–10, in this order:
 * how Farq works (a connected journey, الشايب walking stage to stage) · the comparison (the selling point) ·
 * any business · supplier conversations in one place · plans · five questions · the closing.
 * Prices, suppliers and conversations here are illustrations, each labelled «مثال توضيحي».
 * Plans: the project has no published prices (checked: both repos) — the section says how it works, no numbers.
 */

function SectionTitle({ id, kicker, title, sub }: { id: string; kicker?: string; title: string; sub?: string }) {
  return (
    <div className="ld-reveal flex flex-col items-start gap-[var(--space-8)] md:items-center md:text-center">
      {kicker ? <p className={cx(T.smallM, 'text-[var(--ld-accent-light)]')}>{kicker}</p> : null}
      <h2 id={id} className="font-display text-[28px] font-bold leading-[40px] md:text-[40px] md:leading-[56px]">{title}</h2>
      {sub ? <p className={cx(T.bodyL, 'max-w-[680px] text-[var(--color-text-secondary)]')}>{sub}</p> : null}
    </div>
  )
}
const card = 'rounded-[var(--radius-xl)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]'
const exampleTag = (text = 'مثال توضيحي') => <span className="rounded-[var(--radius-full)] bg-[var(--color-bg-surface-2)] px-[var(--space-12)] py-[2px] text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">{text}</span>

/* ── §5 · شوف كيف فرق يشتغل — a connected journey; الشايب walks from stage to stage ── */
const STAGES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'edit', title: 'الشركة تكتب احتياجها', body: 'سطر واحد يكفي، أو ملف، أو صورة.' },
  { icon: 'search', title: 'فرق يحدد الموردين', body: 'حسب الصنف والمدينة، ومن سبق وسعّر نفس النوع.' },
  { icon: 'message', title: 'يتواصل ويجمع الردود', body: 'واتساب ورسائل وإيميل، وكل رد في مكان واحد.' },
  { icon: 'check-circle', title: 'تقارن وتختار', body: 'الأسعار والمواصفات ومدة التوريد جنب بعض.' },
]
function useDesktop() {
  const [d, setD] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(min-width: 768px)').matches)
  useEffect(() => { const m = matchMedia('(min-width: 768px)'); const on = () => setD(m.matches); m.addEventListener('change', on); return () => m.removeEventListener('change', on) }, [])
  return d
}
function Journey() {
  const box = useRef<HTMLOListElement>(null)
  const desktop = useDesktop()
  const [at, setAt] = useState(0)          // the stage الشايب stands at (or walks to)
  const [walking, setWalking] = useState(false)
  const [started, setStarted] = useState(false)
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  useEffect(() => {
    const el = box.current
    if (!el || reduce) { setAt(STAGES.length - 1); return }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setStarted(true) }, { threshold: 0.4 })
    io.observe(el)
    return () => io.disconnect()
  }, [reduce])
  useEffect(() => {
    if (!started || reduce) return
    let i = 0, t: number | undefined
    const step = () => {
      setWalking(true)
      t = window.setTimeout(() => {
        setWalking(false)
        i = (i + 1) % STAGES.length
        setAt(i)
        t = window.setTimeout(step, i === 0 ? 2600 : 1700)
      }, 1300)
    }
    t = window.setTimeout(step, 900)
    return () => window.clearTimeout(t)
  }, [started, reduce])
  // where he is: stages sit on a line (RTL: stage 0 at the right on desktop, at the top on phones)
  const next = walking ? (at + 1) % STAGES.length : at
  const back = walking && next === 0
  const pct = (next / (STAGES.length - 1)) * 100
  const dir: ShayebDir = desktop ? (back ? 'E' : 'W') : back ? 'N' : 'S'
  return (
    <section id="how" aria-labelledby="how-title" className="py-[var(--space-48)] md:py-[var(--space-80)]">
      <Container className="flex flex-col gap-[var(--space-40)]">
        <SectionTitle id="how-title" kicker="كيف يعمل" title="شوف كيف فرق يشتغل" sub="من أول سطر تكتبه إلى العرض اللي تختاره، فرق يمشي الطريق عنك." />
        <div className="relative">
          <ol ref={box} className="relative grid gap-[var(--space-24)] ps-[64px] md:grid-cols-4 md:ps-0 md:pt-[120px]">
            <span aria-hidden="true" className="absolute bottom-[24px] start-[23px] top-[24px] w-px bg-[var(--color-border-strong)] md:bottom-auto md:end-[12.5%] md:start-[12.5%] md:top-[136px] md:h-px md:w-auto" />
            {STAGES.map((st, i) => (
              <li key={st.title} className={cx(card, 'relative flex flex-col gap-[var(--space-8)] p-[var(--space-20)] transition-[border-color,box-shadow] duration-500', at === i && !walking ? 'border-[var(--color-border-primary)] shadow-[var(--glow-primary)]' : '')}>
                <span aria-hidden="true" className={cx('absolute -start-[52px] top-[20px] inline-flex size-6 items-center justify-center rounded-full border-2 md:start-1/2 md:-top-[28px] md:-translate-x-1/2 md:translate-x-1/2', at >= i ? 'border-[var(--ld-accent)] bg-[var(--ld-accent)]' : 'border-[var(--color-border-strong)] bg-[var(--color-bg-canvas)]')} />
                <span className="inline-flex size-10 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-bg-primary-subtle)] text-[var(--color-icon-primary)]"><Icon name={st.icon} size={20} /></span>
                <span className={T.title}><span className="text-[var(--color-text-tertiary)]">{i + 1}. </span>{st.title}</span>
                <span className={cx(T.small, 'text-[var(--color-text-secondary)]')}>{st.body}</span>
              </li>
            ))}
          </ol>
          {/* الشايب on the line: walks towards the next stage, stops at each one */}
          <div aria-hidden="true" className="pointer-events-none absolute transition-[inset] ease-in-out motion-reduce:transition-none"
            style={desktop
              ? { top: 0, insetInlineStart: `calc(12.5% + ${pct * 0.75}% - 36px)`, transitionDuration: walking ? '1300ms' : '0ms' }
              : { insetInlineStart: -6, top: `calc(${pct}% * 0.82)`, transitionDuration: walking ? '1300ms' : '0ms' }}>
            <Shayeb mood={walking ? 'working' : 'idle'} dir={dir} height={desktop ? 112 : 72} />
          </div>
        </div>
      </Container>
    </section>
  )
}

/* ── §6 · The comparison — the selling point. Example: a clinic's 20 waiting chairs. ── */
type Offer = { name: string; unit: number; qty: number; delivery: number; days: string; spec: string; match: boolean; note: string; channel: Channel }
const OFFERS: Offer[] = [
  { name: 'مورد أ', unit: 380, qty: 20, delivery: 250, days: '5 أيام', spec: 'كرسي منفصل، قماش طبي قابل للتنظيف', match: true, note: 'مطابق للطلب', channel: 'WhatsApp' },
  { name: 'مورد ب', unit: 340, qty: 20, delivery: 400, days: '7 أيام', spec: 'مقعد متصل (3 كراسي) — مو منفصل', match: false, note: 'مواصفات مختلفة عن طلبك', channel: 'Email' },
  { name: 'مورد ج', unit: 455, qty: 20, delivery: 0, days: '3 أيام', spec: 'كرسي منفصل، جلد صناعي', match: true, note: 'مطابق · أسرع توريد', channel: 'WhatsApp' },
]
const total = (o: Offer) => o.unit * o.qty + o.delivery
const sar = (v: number) => `${v.toLocaleString('en-US')} ر.س`
function Compare() {
  const ranked = [...OFFERS].sort((a, b) => Number(b.match) - Number(a.match) || total(a) - total(b))
  const best = ranked[0]
  const [pick, setPick] = useState(OFFERS.indexOf(best))
  const o = OFFERS[pick]
  const priciest = Math.max(...OFFERS.filter((x) => x.match).map(total))
  const rows: [string, (x: Offer) => string][] = [
    ['سعر الوحدة', (x) => sar(x.unit)], ['الكمية', (x) => `${x.qty} كرسي`], ['التوصيل', (x) => (x.delivery ? sar(x.delivery) : 'مجاني')],
    ['الإجمالي', (x) => sar(total(x))], ['مدة التوريد', (x) => x.days], ['المواصفات', (x) => x.spec],
  ]
  return (
    <section id="compare" aria-labelledby="compare-title" className="py-[var(--space-48)] md:py-[var(--space-80)]">
      <Container className="flex flex-col gap-[var(--space-32)]">
        <SectionTitle id="compare-title" kicker="المقارنة" title="وش الفرق؟ بنظرة وحدة" sub="كل العروض على نفس الأساس. والأرخص مو دايم الأنسب: لو المواصفات أو الكمية مختلفة، نوضّحها لك." />
        <div className="ld-reveal flex items-center justify-between gap-[var(--space-12)]">
          <p className={T.bodyM}>طلب: 20 كرسي انتظار منفصل — عيادة بالرياض</p>
          {exampleTag()}
        </div>
        <div className="grid gap-[var(--space-16)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          {/* offers: swipe on phones, a column on desktop */}
          <ul role="tablist" aria-label="عروض الموردين" className="-mx-[var(--space-16)] flex snap-x snap-mandatory gap-[var(--space-12)] overflow-x-auto px-[var(--space-16)] pb-[var(--space-8)] lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
            {OFFERS.map((x, i) => (
              <li key={x.name} role="presentation" className="w-[82%] shrink-0 snap-center sm:w-[60%] lg:w-auto">
                <button type="button" role="tab" aria-selected={pick === i} onClick={() => setPick(i)}
                  className={cx(card, 'flex w-full flex-col gap-[var(--space-8)] p-[var(--space-16)] text-start transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-0.5', pick === i && 'border-[var(--color-border-primary)] shadow-[var(--glow-primary)]', FOCUS_RING)}>
                  <span className="flex items-center justify-between gap-[var(--space-8)]">
                    <span className="flex items-center gap-[var(--space-8)]"><span className={T.title}>{x.name}</span><ChannelBadge channel={x.channel} /></span>
                    {x === best ? <span className="rounded-[var(--radius-full)] bg-[var(--ld-accent)] px-[var(--space-12)] py-[2px] text-[13px] font-semibold text-[var(--ld-bg)]">الأنسب</span> : null}
                  </span>
                  <span className="font-display text-[26px] font-bold tabular-nums leading-[36px]">{sar(total(x))}</span>
                  <span className={cx('flex items-center gap-[6px] text-[13px]', x.match ? 'text-[var(--color-text-success)]' : 'text-[var(--color-text-warning)]')}>
                    <Icon name={x.match ? 'check-circle' : 'alert'} size={16} />{x.note}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {/* the picked offer next to the best one */}
          <div key={pick} className={cx(card, 'ld-pop flex flex-col gap-[var(--space-16)] p-[var(--space-20)] md:p-[var(--space-24)]')} role="tabpanel" aria-label={`تفاصيل ${o.name}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-8)]">
              <h3 className={T.h3}>{o.name}</h3>
              {o === best
                ? <p className="text-[15px] text-[var(--color-text-secondary)]">أقل تكلفة مطابقة للشروط — توفّر <strong className="font-display text-[22px] text-[var(--ld-accent-light)]">{sar(priciest - total(best))}</strong> عن أعلى عرض مطابق</p>
                : <p className="text-[15px] text-[var(--color-text-secondary)]">{o.match ? <>أغلى من الأنسب بـ <strong className="text-[var(--color-text-primary)]">{sar(total(o) - total(best))}</strong></> : <>أرخص بـ <strong className="text-[var(--color-text-primary)]">{sar(total(best) - total(o))}</strong>، لكن مواصفاته مختلفة</>}</p>}
            </div>
            <dl className="flex flex-col divide-y divide-[var(--color-border-default)]">
              {rows.map(([k, f]) => (
                <div key={k} className="grid grid-cols-[110px_1fr] gap-[var(--space-12)] py-[var(--space-12)] md:grid-cols-[140px_1fr_1fr]">
                  <dt className="text-[14px] text-[var(--color-text-secondary)]">{k}</dt>
                  <dd className={cx('text-[15px] tabular-nums', k === 'الإجمالي' && 'font-semibold')}>{f(o)}</dd>
                  <dd className="hidden text-[13px] text-[var(--color-text-tertiary)] md:block">{o === best ? '' : `الأنسب: ${f(best)}`}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Container>
    </section>
  )
}

/* ── §7 · Any business — examples of real-looking requests, not sector limits ── */
const SECTORS: { icon: IconName; who: string; ask: string }[] = [
  { icon: 'plus', who: 'عيادة', ask: '20 كرسي انتظار لصالة المراجعين' },
  { icon: 'tag', who: 'مطعم', ask: '5000 علبة تغليف بشعار المطعم' },
  { icon: 'building', who: 'فندق', ask: 'مفروشات لـ 40 غرفة' },
  { icon: 'grid', who: 'مكتب', ask: '30 جهاز كمبيوتر للموظفين' },
  { icon: 'sliders', who: 'مصنع', ask: 'قطع غيار لخط الإنتاج' },
  { icon: 'truck', who: 'مقاول', ask: 'حديد وأسمنت لمشروع سكني' },
]
function Sectors() {
  return (
    <section id="sectors" aria-labelledby="sectors-title" className="py-[var(--space-48)] md:py-[var(--space-80)]">
      <Container className="flex flex-col gap-[var(--space-32)]">
        <SectionTitle id="sectors-title" kicker="لكل الأنشطة" title="مهما كان نشاط منشأتك، فرق يسعّر مشترياتك." />
        <ul className="grid grid-cols-1 gap-[var(--space-12)] sm:grid-cols-2 lg:grid-cols-3">
          {SECTORS.map((x) => (
            <li key={x.who} className={cx(card, 'ld-reveal flex items-center gap-[var(--space-12)] p-[var(--space-16)] transition-transform duration-300 hover:-translate-y-0.5')}>
              <span aria-hidden="true" className="inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-bg-primary-subtle)] text-[var(--color-icon-primary)]"><Icon name={x.icon} size={22} /></span>
              <span className="flex min-w-0 flex-col">
                <span className="text-[13px] text-[var(--color-text-tertiary)]">{x.who}</span>
                <span className={cx(T.bodyM, 'truncate')}>«{x.ask}»</span>
              </span>
            </li>
          ))}
        </ul>
        <p className={cx(T.bodyM, 'ld-reveal text-center text-[var(--color-text-secondary)]')}>وغيرها من مشتريات الشركات والمنشآت.</p>
      </Container>
    </section>
  )
}

/* ── §8 · Supplier conversations in one place — drawn like the real inbox (06), example data ── */
const THREADS: { name: string; preview: string; when: string; tone: BadgeTone | null; label: string; channel: Channel }[] = [
  { name: 'مورد أ', preview: 'السعر 380 للكرسي، والتوصيل 250', when: '5 د', tone: 'Success', label: 'أرسل سعر', channel: 'WhatsApp' },
  { name: 'مورد ج', preview: 'مرفق عرض السعر PDF', when: '12 د', tone: 'Success', label: 'أرسل سعر', channel: 'WhatsApp' },
  { name: 'مورد ب', preview: 'تبون اللون الرمادي أو الأزرق؟', when: '30 د', tone: 'Warning', label: 'يسأل', channel: 'Email' },
  { name: 'مورد د', preview: 'نعتذر، غير متوفر حاليًا', when: '1 س', tone: 'Danger', label: 'اعتذر', channel: 'WhatsApp' },
  { name: 'مورد هـ', preview: 'تم الإرسال · بانتظار الرد', when: '1 س', tone: null, label: 'ما رد', channel: 'WhatsApp' },
]
function Inbox() {
  const counts = [['تم التواصل', '12'], ['ردّوا', '7'], ['عروض وصلت', '4'], ['استفسارات', '1']]
  return (
    <section id="inbox" aria-labelledby="inbox-title" className="py-[var(--space-48)] md:py-[var(--space-80)]">
      <Container className="flex flex-col gap-[var(--space-32)]">
        <SectionTitle id="inbox-title" kicker="المتابعة" title="كل ردود الموردين في مكان واحد" sub="بدل عشرات المحادثات المتفرقة: تشوف مين تواصلنا معه، مين رد، وش العروض اللي وصلت، ووش الأسئلة اللي تنتظرك." />
        <div className={cx(card, 'ld-reveal overflow-hidden')}>
          <div className="flex items-center justify-between gap-[var(--space-8)] border-b border-[var(--color-border-default)] px-[var(--space-16)] py-[var(--space-12)]">
            <p className={T.bodyM}>صندوق الوارد · طلب 20 كرسي انتظار</p>{exampleTag()}
          </div>
          <dl className="grid grid-cols-2 gap-px bg-[var(--color-border-default)] sm:grid-cols-4">
            {counts.map(([k, v]) => <div key={k} className="flex flex-col bg-[var(--color-bg-surface)] px-[var(--space-16)] py-[var(--space-12)]"><dt className="text-[13px] text-[var(--color-text-secondary)]">{k}</dt><dd className="font-display text-[24px] font-semibold tabular-nums">{v}</dd></div>)}
          </dl>
          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <ul className="border-t border-[var(--color-border-default)] lg:border-e">
              {THREADS.map((t, i) => (
                <li key={t.name} className={cx('flex flex-col gap-[6px] border-b border-[var(--color-border-default)] px-[var(--space-16)] py-[var(--space-12)]', i === 0 && 'bg-[var(--color-bg-primary-subtle)]')}>
                  <span className="flex items-baseline justify-between gap-[var(--space-12)]"><span className="font-medium">{t.name}</span><span className="text-[12px] text-[var(--color-text-tertiary)]">{t.when}</span></span>
                  <span className="truncate text-[14px] text-[var(--color-text-secondary)]">{t.preview}</span>
                  <span className="flex items-center gap-[var(--space-8)]"><ChannelBadge channel={t.channel} />{t.tone ? <Badge tone={t.tone} label={t.label} className="text-[12px] leading-[18px]" /> : <span className="text-[12px] text-[var(--color-text-tertiary)]">{t.label}</span>}</span>
                </li>
              ))}
            </ul>
            <div className="hidden flex-col gap-[var(--space-12)] border-t border-[var(--color-border-default)] p-[var(--space-16)] lg:flex">
              <p className="self-end rounded-[var(--radius-lg)] rounded-ee-[4px] bg-[var(--color-bg-surface-2)] px-[var(--space-12)] py-[var(--space-8)] text-[14px]">السلام عليكم، عندنا طلب 20 كرسي انتظار لعيادة بالرياض. ممكن سعركم شامل التوصيل؟</p>
              <p className="self-start rounded-[var(--radius-lg)] rounded-es-[4px] bg-[var(--color-bg-primary-subtle)] px-[var(--space-12)] py-[var(--space-8)] text-[14px]">هلا، السعر 380 للكرسي، والتوصيل 250 داخل الرياض، خلال 5 أيام.</p>
              <div className="mt-auto flex items-center justify-between gap-[var(--space-8)] rounded-[var(--radius-md)] border border-[var(--color-border-primary)] p-[var(--space-12)]">
                <span className="flex flex-col"><span className="text-[12px] text-[var(--color-text-tertiary)]">العرض المستخرج من المحادثة</span><span className="font-medium">20 × 380 + توصيل 250</span></span>
                <span className="font-display text-[18px] font-semibold tabular-nums text-[var(--ld-accent-light)]">7,850 ر.س</span>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  )
}

/* ── §9 · Plans — no published prices exist in the project, so none are shown ── */
const INCLUDES = ['فهم الطلبات المكتوبة والملفات والصور', 'التواصل مع الموردين بالنيابة عنك', 'صندوق وارد واحد لكل الردود', 'مقارنة العروض على نفس الأساس', 'تسجيل قرار الترسية وسببه']
function Plans() {
  return (
    <section id="plans" aria-labelledby="plans-title" className="py-[var(--space-48)] md:py-[var(--space-80)]">
      <Container className="flex flex-col gap-[var(--space-32)]">
        <SectionTitle id="plans-title" kicker="الباقات" title="اشتراك يناسب حجم مشترياتك" sub="باقات للشركات حسب عدد الطلبات والمستخدمين. السعر نتفق عليه معك قبل أي دفع." />
        <div className="grid gap-[var(--space-16)] lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className={cx(card, 'ld-reveal flex flex-col gap-[var(--space-16)] p-[var(--space-24)]')}>
            <h3 className={T.h3}>كل باقة تشمل</h3>
            <ul className="grid gap-[var(--space-12)] sm:grid-cols-2">
              {INCLUDES.map((x) => <li key={x} className={cx(T.body, 'flex items-start gap-[var(--space-8)]')}><Icon name="check" size={20} className="mt-[3px] shrink-0 text-[var(--color-icon-success)]" />{x}</li>)}
            </ul>
            <p className={cx(T.small, 'rounded-[var(--radius-md)] bg-[var(--color-bg-surface-2)] px-[var(--space-12)] py-[var(--space-8)] text-[var(--color-text-secondary)]')}>رسوم إضافية: رسائل واتساب المدفوعة للموردين تُحسب حسب تسعيرة واتساب، وتشوف تكلفتها وتوافق عليها قبل كل إرسال.</p>
          </div>
          <div className="ld-reveal flex flex-col justify-between gap-[var(--space-16)] rounded-[var(--radius-xl)] p-[var(--space-24)]" style={{ background: 'var(--ld-gradient)' }}>
            <div className="flex flex-col gap-[var(--space-8)]">
              <h3 className={T.h3}>كيف تشترك</h3>
              <ol className="flex flex-col gap-[var(--space-8)] text-[15px] leading-[24px] text-[var(--color-text-secondary)]">
                <li>1. كلمنا عن مشترياتك وعدد المستخدمين.</li>
                <li>2. نرسل لك عرض الباقة المناسب.</li>
                <li>3. توافق وتشترك، وتبدأ أول طلب.</li>
              </ol>
            </div>
            <div className="flex flex-wrap gap-[var(--space-8)]">
              <LinkButton href={WHATSAPP_HREF} external variant="Accent" icon="whatsapp">اطلب عرض الباقة</LinkButton>
              <LinkButton href={ENTERPRISE_EMAIL_HREF} variant="GhostOnDark">للمؤسسات</LinkButton>
            </div>
          </div>
        </div>
      </Container>
    </section>
  )
}

/* ── §10 · Five questions — answers match what the system does ── */
const FAQ = [
  { q: 'هل فرق مناسب لنشاط شركتي؟', a: 'إذا عندك مشتريات من موردين في السعودية، إيه. نوصل لموردين في كل الأنشطة والمدن، من المستلزمات اليومية إلى المعدات.' },
  { q: 'كيف يتم التواصل مع الموردين؟', a: 'فرق يتواصل معهم بالواتساب والرسائل والإيميل، وكل الردود تجيك في صندوق وارد واحد. ما يطلع أي طلب قبل ما تراجعه وتأكد.' },
  { q: 'هل أقدر أقارن العروض قبل الاختيار؟', a: 'إيه. تشوف العروض جنب بعض: الإجمالي، مدة التوريد، وهل العرض كامل ومطابق لطلبك.' },
  { q: 'هل يلزمني قبول أي عرض؟', a: 'لا. الترسية قرارك أنت، وتقدر ما ترسّي على أحد.' },
  { q: 'كيف يعمل الاشتراك؟', a: 'باقة لشركتك حسب عدد طلباتها ومستخدميها، والسعر نتفق عليه معك قبل أي دفع. رسائل الواتساب المدفوعة تشوف تكلفتها قبل كل إرسال.' },
]
function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="py-[var(--space-48)] md:py-[var(--space-64)]">
      <Container className="flex flex-col items-center gap-[var(--space-24)]">
        <SectionTitle id="faq-title" title="أسئلة قبل ما تبدأ" />
        <div className="flex w-full max-w-[820px] flex-col gap-[var(--space-12)]">
          {FAQ.map((f) => (
            <details key={f.q} className={cx(card, 'group')}>
              <summary className={cx(T.bodyM, 'flex cursor-pointer list-none items-center justify-between gap-[var(--space-12)] rounded-[var(--radius-xl)] px-[var(--space-20)] py-[var(--space-16)] [&::-webkit-details-marker]:hidden', FOCUS_RING)}>
                {f.q}
                <span aria-hidden="true" className="shrink-0 text-[var(--color-icon-secondary)] transition-transform group-open:rotate-45"><Icon name="plus" size={20} /></span>
              </summary>
              <p className={cx(T.body, 'px-[var(--space-20)] pb-[var(--space-16)] text-[var(--color-text-secondary)]')}>{f.a}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  )
}

/* ── Closing ── */
function FinalCta() {
  const start = () => { window.dispatchEvent(new Event('farq-start')); document.getElementById('top')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  return (
    <section aria-labelledby="final-title" className="py-[var(--space-48)] md:py-[var(--space-80)]">
      <Container>
        <div className="ld-reveal relative overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border-primary)] px-[var(--space-24)] py-[var(--space-48)] text-center md:py-[var(--space-80)]" style={{ background: 'var(--ld-gradient)' }}>
          <h2 id="final-title" className="font-display text-[32px] font-bold leading-[44px] md:text-[52px] md:leading-[68px]">طلب الشراء الجاي؟ خلّه علينا.</h2>
          <p className={cx(T.bodyL, 'mx-auto mt-[var(--space-12)] max-w-[560px] text-[var(--color-text-secondary)]')}>اكتب وش تحتاج، والباقي علينا: الموردين، المتابعة، والمقارنة.</p>
          <div className="mt-[var(--space-24)] flex flex-wrap justify-center gap-[var(--space-12)]">
            <button type="button" onClick={start} className={cx('inline-flex h-14 items-center gap-[var(--space-8)] rounded-[var(--radius-md)] bg-[var(--ld-accent)] px-[var(--space-32)] text-[18px] font-semibold text-[var(--ld-bg)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[var(--glow-primary)] motion-reduce:transition-none', FOCUS_RING)}>
              ابدأ طلب تسعير<Icon name="arrow-forward" size={20} />
            </button>
            <LinkButton href={WHATSAPP_HREF} external variant="GhostOnDark" size="L" icon="whatsapp" className="h-14">كلمنا واتساب</LinkButton>
          </div>
        </div>
      </Container>
    </section>
  )
}

/* ── Footer 37:327 · mobile 60:858 — contact (decision 2) ── */
export function Footer() {
  const muted = cx(T.small, 'text-[var(--color-text-secondary)]')
  return (
    <footer data-tone="deep" className={cx(DEEP_FOCUS, 'bg-[var(--color-bg-canvas)] py-[var(--space-48)] text-[var(--color-text-primary)] md:py-[var(--space-64)]')}>
      <Container className="flex flex-col gap-[var(--space-32)] md:gap-[var(--space-40)]">
        <div className="grid gap-[var(--space-32)] md:grid-cols-[1.4fr_1fr_1fr_auto]">
          <div className="flex flex-col gap-[var(--space-12)]">
            <Logo surface="Inverse" />
            <p className={cx(muted, 'max-w-[300px]')}>نبحث أكثر، نقارن صح، ونطلع لك الفرق الحقيقي.</p>
          </div>
          <nav aria-label="المنتج" className="flex flex-col gap-[var(--space-12)]">
            <h2 className={T.bodyM}>المنتج</h2>
            <TextLink href="#how" className={muted}>كيف تعمل</TextLink>
            <span className={muted}>للموردين <span className="text-[var(--color-text-tertiary)]">(قريبًا)</span></span>
          </nav>
          <div className="flex flex-col gap-[var(--space-12)]">
            <h2 className={T.bodyM}>تواصل معنا</h2>
            <p className={muted}>
              واتساب:{' '}
              <TextLink href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer" className="text-[var(--color-text-primary)]">
                <bdi dir="ltr">{WHATSAPP_NUMBER_DISPLAY}</bdi>
              </TextLink>
            </p>
            <p className={muted}>
              الإيميل:{' '}
              <TextLink href={EMAIL_HREF} className="text-[var(--color-text-primary)]">
                <bdi dir="ltr">{EMAIL}</bdi>
              </TextLink>
            </p>
          </div>
          <div>
            <LinkButton href={WHATSAPP_HREF} external variant="Secondary" size="M" icon="whatsapp">كلمنا واتساب</LinkButton>
          </div>
        </div>
        <div className="h-px w-full bg-[var(--white-a16)]" />
        <div className="flex flex-col gap-[var(--space-8)] md:flex-row md:items-center md:justify-between">
          <p className={cx(T.caption, 'text-[var(--color-text-secondary)]')}>© 2026 مؤسسة فرق التقنية · س.ت [يُحدَّد] · الرقم الضريبي [يُحدَّد]</p>
          <p className={cx(T.caption, 'text-[var(--color-text-tertiary)]')}>من نحن · الخصوصية · الشروط — صفحات قيد الإعداد</p>
        </div>
      </Container>
    </footer>
  )
}

export default function Below() {
  // scroll reveal for .ld-reveal (opacity/transform only; CSS turns it off for reduced motion)
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>('.ld-reveal')]
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target) } }), { rootMargin: '0px 0px -10% 0px' })
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
  return (
    <>
      <Journey />
      <Compare />
      <Sectors />
      <Inbox />
      <Plans />
      <Faq />
      <FinalCta />
    </>
  )
}
