import { Badge } from '../../../ui/Badge'
import { PriceCell } from '../../../ui/PriceCell'
import { Icon } from '../../../ui/Icon'
import { Logo } from '../../../ui/Logo'
import { cx, FOCUS_RING } from '../../../ui/cx'
import booklet from '../../../assets/spot/booklet.svg'
import list from '../../../assets/spot/list.svg'
import photo from '../../../assets/spot/photo.svg'
import { EMAIL, EMAIL_HREF, START_HREF, WHATSAPP_HREF, WHATSAPP_NUMBER_DISPLAY } from '../contact'
import { Container, DEEP_FOCUS, LinkButton, LiveBgSlot, T, TextLink } from '../kit'
import { HowWePrice } from './HowWePrice'

/*
 * Everything below the hero — one lazily loaded chunk so the hero paints first.
 * Figma desktop 33:2 children (34:59 … 37:327), mobile 60:728.
 * Prices, supplier names and quantities in the mock cards/table are Figma's illustration, labelled «توضيحية».
 * Seven sections (owner, 2026-10-08): hero · how it works (+ how we price) · the difference · who it is for · FAQ ·
 * start · footer. The trust figures, the pricing plans, the split bands and the inbox showcase are out until they
 * have real numbers and copy (docs/qa/open-issues.md §5). One calm light page; the footer is the only dark band.
 */


function SectionTitle({ id, title, sub, className }: { id: string; title: string; sub?: string; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center gap-[var(--space-8)] text-center', className)}>
      <h2 id={id} className={T.h1}>{title}</h2>
      {sub ? <p className={cx(T.bodyL, 'max-w-[720px] text-[var(--color-text-secondary)]')}>{sub}</p> : null}
    </div>
  )
}

/* ── Split blocks 34:59 (desktop) · Block / Deep 60:765 + Block / Accent 60:773 (mobile) ── */
const METHODS = [
  { n: '01', spot: booklet, title: 'ارفع الكراسة', body: 'ملف Excel أو PDF — نقرأ البنود والكميات تلقائيًا، وأي بند غامض نسألك عنه.' },
  { n: '02', spot: list, title: 'اكتب الطلبات', body: 'سطر لكل بند: «كيبل 4×16 — 500 متر». نقترح لك المواصفات الناقصة.' },
  { n: '03', spot: photo, title: 'صوّرها', body: 'صورة كراسة ورقية أو قطعة تبي مثلها. نفهمها ونرجع لك بالبنود للمراجعة.' },
]

function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-title" className="relative overflow-hidden bg-[var(--color-bg-canvas)] py-[var(--space-48)] md:py-[var(--space-96)]">
      <LiveBgSlot tone="light" />
      <Container className="flex flex-col items-center gap-[var(--space-24)] md:gap-[var(--space-48)]">
        <SectionTitle id="how-title" title="ثلاث طرق، طلب واحد" sub="اختار الأسهل لك — والباقي علينا." />
        <ul className="grid w-full gap-[var(--space-12)] md:grid-cols-3 md:gap-[var(--space-24)]">
          {METHODS.map((m) => (
            <li key={m.n} className="flex items-center gap-[var(--space-16)] rounded-[var(--radius-xl)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-[var(--space-20)] md:h-[300px] md:flex-col md:items-start md:bg-[var(--color-bg-canvas)] md:p-[var(--space-32)]">
              <div className="flex shrink-0 items-start justify-between md:w-full">
                <img src={m.spot} alt="" width={64} height={64} loading="lazy" className="size-12 md:size-16" />
                <span aria-hidden="true" className={cx(T.numBase, 'hidden text-[var(--color-text-tertiary)] md:block')}>{m.n}</span>
              </div>
              <div className="flex flex-col gap-[var(--space-4)] md:gap-[var(--space-16)]">
                <h3 className={cx(T.h3, 'text-[var(--color-text-primary)]')}>{m.title}</h3>
                <p className={cx(T.small, 'text-[var(--color-text-secondary)] md:text-[16px] md:leading-[26px]')}>{m.body}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className={cx(T.bodyM, 'flex items-center gap-[var(--space-8)] rounded-[var(--radius-xl)] bg-[var(--color-bg-success)] px-[var(--space-20)] py-[var(--space-12)] text-[var(--color-text-primary)] md:rounded-[var(--radius-full)]')}>
          <Icon name="check" size={20} style={{ color: 'var(--color-icon-success)' }} />
          كلها تتحول لطلب تسعير واحد، تراجعه قبل ما نرسله لأي مورد.
        </p>
        <HowWePrice />
      </Container>
    </section>
  )
}

/* ── Difference explainer 35:115 · mobile 60:815 ── */
const OFFERS = [
  { name: 'مستودع الرياض للكهرباء', short: 'مستودع الرياض', best: true, items: '41,200.00 ر.س', delivery: 'مجاني', vat: '6,180.00 ر.س', days: '3 أيام', warranty: 'سنة', landed: '47,380.00 ر.س', delta: 'الأقل' },
  { name: 'مؤسسة النور للكهرباء', short: 'مؤسسة النور', best: false, items: '42,500.00 ر.س', delivery: '350.00 ر.س', vat: '6,427.50 ر.س', days: '5 أيام', warranty: 'سنة', landed: '49,277.50 ر.س', delta: '+1,897.50 ر.س (4.0%)' },
  { name: 'شركة الخليج للكابلات', short: 'شركة الخليج', best: false, items: '44,800.00 ر.س', delivery: 'مجاني', vat: '6,720.00 ر.س', days: '7 أيام', warranty: 'بدون', landed: '51,520.00 ر.س', delta: '+4,140.00 ر.س (8.7%)' },
]
const ROWS: Array<{ key: 'items' | 'delivery' | 'vat' | 'days' | 'warranty'; label: string; differs?: boolean; num?: boolean }> = [
  { key: 'items', label: 'سعر البنود', num: true },
  { key: 'delivery', label: 'التوصيل', differs: true },
  { key: 'vat', label: 'ضريبة القيمة المضافة 15%', num: true },
  { key: 'days', label: 'مدة التوريد', differs: true },
  { key: 'warranty', label: 'الضمان', differs: true },
]

function Difference() {
  const cell = 'px-[var(--space-24)] py-[var(--space-12)] text-start align-middle'
  return (
    <section id="difference" aria-labelledby="difference-title" className="relative overflow-hidden bg-[var(--color-bg-canvas)] py-[var(--space-48)] md:py-[var(--space-96)]">
      <LiveBgSlot tone="light" />
      <Container className="flex flex-col items-center gap-[var(--space-24)] md:gap-[var(--space-40)]">
        <SectionTitle id="difference-title" title="وش الفرق؟ بنظرة وحدة" sub="نحسب التكلفة الواصلة لكل عرض — السعر + التوصيل + ضريبة 15% — ونخفي الخصائص المتطابقة عشان يبان اللي يفرق فعلًا." />

        {/* Desktop/tablet: the comparison table */}
        <div className="hidden w-full overflow-x-auto rounded-[var(--radius-xl)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] md:block">
          <table className="w-full min-w-[720px] border-collapse text-[var(--color-text-primary)]">
            <caption className="sr-only">مثال توضيحي: مقارنة ثلاثة عروض على كيبل نحاس 4×16 مم² — 500 متر، الرياض</caption>
            <thead>
              <tr className="border-b border-[var(--color-border-default)]">
                <th scope="col" className={cx(cell, 'h-[88px] w-1/4 font-medium')}>
                  <span className={cx(T.bodyM, 'block')}>كيبل نحاس 4×16 مم²</span>
                  <span className={cx(T.caption, 'block text-[var(--color-text-secondary)]')}>500 متر · الرياض</span>
                </th>
                {OFFERS.map((o) => (
                  <th key={o.name} scope="col" className={cx(cell, 'w-1/4 font-medium', o.best && 'bg-[var(--color-bg-success)]')}>
                    <span className={cx(T.bodyM, 'block')}>{o.name}</span>
                    {o.best ? <Badge tone="Success" label="الأفضل" className="mt-[var(--space-4)] bg-transparent px-0" /> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.key} className="h-[64px] border-b border-[var(--color-border-default)]">
                  <th scope="row" className={cx(cell, T.smallM, 'text-[var(--color-text-secondary)]')}>
                    <span className="inline-flex items-center gap-[var(--space-8)]">
                      {r.label}
                      {r.differs ? <Badge tone="Warning" label="يختلف" showDot={false} /> : null}
                    </span>
                  </th>
                  {OFFERS.map((o) => (
                    <td key={o.name} className={cx(cell, r.num ? T.numSmall : T.smallM, o.best && 'bg-[var(--color-bg-success)]')}>{o[r.key]}</td>
                  ))}
                </tr>
              ))}
              <tr className="h-[88px] bg-[var(--color-bg-surface-2)]">
                <th scope="row" className={cx(cell, 'font-medium')}>
                  <span className={cx(T.bodyM, 'block')}>التكلفة الواصلة</span>
                  <span className={cx(T.caption, 'block text-[var(--color-text-secondary)]')}>السعر + التوصيل + الضريبة</span>
                </th>
                {OFFERS.map((o) => (
                  <td key={o.name} className={cx(cell, o.best && 'bg-[var(--color-bg-success)]')}>
                    <span className={cx(T.numBase, 'block')}>{o.landed}</span>
                    <span className={cx(T.caption, 'block', o.best ? 'text-[var(--color-text-success)]' : 'text-[var(--color-text-warning)]')}>{o.delta}</span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Phone: the same offers as landed-cost cards (Figma mobile 60:815) */}
        <div className="w-full rounded-[var(--radius-xl)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-[var(--space-16)] md:hidden">
          <p className={cx(T.bodyM, 'mb-[var(--space-12)] text-[var(--color-text-primary)]')}>كيبل نحاس 4×16 مم² — 500 متر</p>
          <ul className="flex flex-col gap-[var(--space-12)]">
            {OFFERS.map((o) => (
              <li key={o.name} className="flex items-center justify-between gap-[var(--space-12)]">
                <span className={cx(T.small, 'text-[var(--color-text-secondary)]')}>{o.short}</span>
                <PriceCell state={o.best ? 'Best' : 'Normal'} price={o.landed} delta={o.best ? 'الأقل سعرًا' : o.delta} />
              </li>
            ))}
          </ul>
          <p className={cx(T.caption, 'mt-[var(--space-12)] text-[var(--color-text-secondary)]')}>التكلفة الواصلة = السعر + التوصيل + ضريبة 15%</p>
        </div>

        <p className={cx(T.small, 'flex items-start gap-[var(--space-8)] text-[var(--color-text-secondary)]')}>
          <Icon name="info" size={18} className="mt-[2px] shrink-0" />
          أخفينا 6 خصائص متطابقة بين العروض (المقطع، العزل، الطول، بلد الصنع، الشهادة، طريقة الدفع) · الأرقام في المثال توضيحية
        </p>
      </Container>
    </section>
  )
}

/* ── Trust strip 35:218 — real figures are not available: placeholders (decision 5) ── */
const AUDIENCE = [
  { icon: 'building' as const, title: 'المقاولون', body: 'كراسة مشروع كاملة تتسعّر بدون ما تتصل بعشرين مورد.' },
  { icon: 'layers' as const, title: 'المصانع', body: 'قطع غيار ومواد خام بشكل متكرر — والمورد الأفضل يبان من التاريخ.' },
  { icon: 'sliders' as const, title: 'التشغيل والصيانة', body: 'طلبات سريعة وصغيرة، بأسعار تقدر تبررها لإدارتك.' },
  { icon: 'grid' as const, title: 'مكاتب إدارة المشاريع', body: 'مقارنة موثّقة تقدر ترفعها للعميل أو للجنة.' },
]

function Audience() {
  return (
    <section id="audience" aria-labelledby="audience-title" className="relative overflow-hidden bg-[var(--color-bg-canvas)] py-[var(--space-48)] md:py-[var(--space-96)]">
      <LiveBgSlot tone="light" />
      <Container className="flex flex-col items-center gap-[var(--space-24)] md:gap-[var(--space-40)]">
        <SectionTitle id="audience-title" title="مصمّمة لفرق المشتريات" />
        <ul className="grid w-full gap-[var(--space-16)] sm:grid-cols-2 lg:grid-cols-4 lg:gap-[var(--space-24)]">
          {AUDIENCE.map((a) => (
            <li key={a.title} className="flex flex-col gap-[var(--space-12)] rounded-[var(--radius-xl)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-[var(--space-24)] py-[28px] lg:h-[220px]">
              <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-bg-primary-subtle)] text-[var(--color-icon-primary)]">
                <Icon name={a.icon} size={24} />
              </span>
              <h3 className={cx(T.h3, 'text-[var(--color-text-primary)]')}>{a.title}</h3>
              <p className={cx(T.body, 'text-[var(--color-text-secondary)]')}>{a.body}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  )
}

/* ── Inbox showcase 37:135 ── */
const FAQ = [
  { q: 'كم ياخذ وقت أول رد؟', a: 'يعتمد على نوع البنود والمدينة. تشوف كل رد لحظة وصوله، ونبلغك إذا تأخر مورد.' },
  { q: 'هل أقدر أرفع كراسة PDF ممسوحة؟' },
  { q: 'هل الأسعار شاملة الضريبة؟' },
  { q: 'كيف تختارون الموردين؟' },
  { q: 'هل أقدر أدعو موردين أعرفهم؟' },
  { q: 'هل فيه رسوم على المورد؟' },
]

function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="relative overflow-hidden bg-[var(--color-bg-canvas)] py-[var(--space-48)] md:py-[var(--space-96)]">
      <LiveBgSlot tone="light" />
      <Container className="flex flex-col items-center gap-[var(--space-16)]">
        <SectionTitle id="faq-title" title="أسئلة تتكرر" />
        <div className="flex w-full max-w-[800px] flex-col gap-[var(--space-16)]">
          {FAQ.map((f, i) => (
            <details key={f.q} open={i === 0} className="group rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
              <summary className={cx(T.bodyM, 'flex cursor-pointer list-none items-center justify-between gap-[var(--space-12)] rounded-[var(--radius-lg)] px-[var(--space-24)] py-[var(--space-20)] text-[var(--color-text-primary)] [&::-webkit-details-marker]:hidden', FOCUS_RING)}>
                {f.q}
                <span aria-hidden="true" className="shrink-0 text-[var(--color-icon-secondary)]">
                  <span className="group-open:hidden"><Icon name="plus" size={20} /></span>
                  <span className="hidden group-open:inline"><Icon name="x" size={20} /></span>
                </span>
              </summary>
              <div className={cx(T.body, 'px-[var(--space-24)] pb-[var(--space-20)] text-[var(--color-text-secondary)]')}>
                {f.a ?? (
                  <>
                    الإجابة قيد الإعداد. اسألنا مباشرة على{' '}
                    <TextLink href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer" className="text-[var(--color-text-link)] underline">واتساب</TextLink>.
                  </>
                )}
              </div>
            </details>
          ))}
        </div>
      </Container>
    </section>
  )
}

/* ── Final CTA 37:317 (accent) ── */
function FinalCta() {
  return (
    <section aria-labelledby="final-title" className="relative overflow-hidden border-t border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] py-[var(--space-48)] text-[var(--color-text-primary)] md:py-[var(--space-80)]">
      <LiveBgSlot tone="accent" />
      <Container className="flex flex-col items-center gap-[var(--space-16)] text-center md:gap-[var(--space-24)]">
        <h2 id="final-title" className={T.displayL}>طلب الشراء الجاي؟ خلّه علينا.</h2>
        <p className={T.bodyL}>ارفعه الحين وشوف أول عرض اليوم.</p>
        <LinkButton href={START_HREF} external variant="Primary" icon="arrow-forward" className="w-full sm:w-auto">ابدأ التسعير</LinkButton>
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
  return (
    <>
      <HowItWorks />
      <Difference />
      <Audience />
      <Faq />
      <FinalCta />
    </>
  )
}
