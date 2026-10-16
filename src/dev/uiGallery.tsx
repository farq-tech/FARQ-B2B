import { FarqGlassButton } from '../ui/FarqGlassButton'
/*
 * DEV-ONLY component gallery: http://localhost:5180/ui
 * Every src/ui component in every state, next to the Figma component-set screenshot
 * (docs/qa/m2/figma/*.png, served by the dev server only). Not part of `vite build`.
 * Hover / focus rows are forced with the same classes the component applies on :hover / :focus-visible.
 */
import { createRoot } from 'react-dom/client'
import { useState, type ReactNode } from 'react'
import {
  Badge, Button, ChannelBadge, Chip, Dropzone, EvidenceBadge, Icon, ICON_NAMES, Input, Logo, NavItem, PriceCell,
  QuoteCard, Money, RiyalSign, Sidebar, Stat, Tabs, TimelineStep, Toast, TopBar, IconButton, SearchField,
  type ButtonStyle,
} from '../ui'

const FOCUS = 'outline-2 outline-offset-2 outline-[var(--color-border-primary)]'
const HOVER: Record<ButtonStyle, string> = {
  Primary: '-translate-y-0.5 shadow-[var(--glow-primary)]',
  Secondary: 'bg-[var(--color-bg-surface-2)]',
  Ghost: 'bg-[var(--color-bg-primary-subtle)]',
  Danger: 'brightness-95',
  Accent: '-translate-y-0.5 shadow-[var(--glow-primary)]',
}

function Section({ id, title, figma, children, note }: { id: string; title: string; figma?: string; children: ReactNode; note?: string }) {
  return (
    <section id={id} className="flex flex-col gap-4 rounded-[var(--radius-xl)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-[family-name:var(--font-display)] text-[20px] leading-[30px] font-semibold">{title}</h2>
        {note ? <p className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{note}</p> : null}
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div className="flex flex-col gap-3">
          <p className="text-[12px] leading-[18px] font-medium text-[var(--color-text-tertiary)]">الكود (src/ui)</p>
          <div className="flex flex-col gap-4">{children}</div>
        </div>
        <div className="flex flex-col gap-3">
          <p className="text-[12px] leading-[18px] font-medium text-[var(--color-text-tertiary)]">Figma</p>
          {figma ? <img src={`/docs/qa/m2/figma/${figma}.png`} alt={`Figma — ${title}`} className="w-full rounded-[var(--radius-md)] border border-[var(--color-border-default)]" /> : null}
        </div>
      </div>
    </section>
  )
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex flex-wrap items-center gap-3"><span className="w-20 shrink-0 text-[12px] text-[var(--color-text-tertiary)]">{label}</span>{children}</div>
)

function Gallery() {
  const [tab, setTab] = useState<'all' | 'quoted' | 'waiting'>('all')
  const [chip, setChip] = useState(true)
  const [file, setFile] = useState<string | null>(null)
  return (
    <div className="min-h-screen bg-[var(--color-bg-canvas)] p-8 text-[var(--color-text-primary)]">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
        <header className="flex items-center justify-between">
          <div className="flex flex-col items-start gap-1">
            <h1 className="font-[family-name:var(--font-display)] text-[32px] leading-[48px] font-bold">مكتبة الواجهة — src/ui</h1>
            <p className="text-[14px] text-[var(--color-text-secondary)]">صفحة تطوير فقط. كل مكوّن بكل حالاته، وبجانبه لقطة Figma.</p>
          </div>
          <Logo />
        </header>

        <Section id="farq-glass" title="FARQ · الأزرار المعتمدة">
          <FarqGlassButton>اعرض الجهات المناسبة</FarqGlassButton>
          <FarqGlassButton variant="secondary" showIcon={false}>ارفع ملفًا</FarqGlassButton>
          <FarqGlassButton variant="ghost" showIcon={false}>رجوع</FarqGlassButton>
          <FarqGlassButton loading>بحث</FarqGlassButton>
          <FarqGlassButton disabled>الإرسال غير متاح</FarqGlassButton>
          <div style={{ width: 180 }}><FarqGlassButton>راجع الجهات والمواصفات قبل اعتماد التواصل</FarqGlassButton></div>
        </Section>
        <Section id="button" title="Button" figma="button" note="Style × State · Size S/M/L">
          {(['Primary', 'Secondary', 'Ghost', 'Danger', 'Accent'] as ButtonStyle[]).map((v) => (
            <Row key={v} label={v}>
              <Button variant={v} icon="send">إرسال الطلب</Button>
              <Button variant={v} icon="send" className={HOVER[v]}>Hover</Button>
              <Button variant={v} icon="send" className={FOCUS}>Focus</Button>
              <Button variant={v} icon="send" disabled>Disabled</Button>
              <Button variant={v} loading>x</Button>
            </Row>
          ))}
          <Row label="Size"><Button size="S" icon="plus">صغير</Button><Button size="M" icon="plus">متوسط</Button><Button size="L" icon="plus">كبير</Button><IconButton icon="bell" label="التنبيهات" /></Row>
        </Section>

        <Section id="input" title="Input" figma="input" note="Default · Hover · Focus · Filled · Error · Disabled">
          <div className="grid grid-cols-2 gap-4">
            <Input label="اسم المشروع" placeholder="مثال: فيلا النرجس" helper="يظهر للموردين في الطلب" />
            <Input label="الميزانية التقديرية" placeholder="0.00" suffix="ر.س" defaultValue="48,000" />
            <Input label="رقم الجوال" defaultValue="05x" error="الرقم ناقص — أدخل 10 أرقام" />
            <Input label="المدينة" defaultValue="الرياض" disabled helper="محددة من الطلب" />
          </div>
        </Section>

        <Section id="chip" title="Chip" figma="chip" note="Default · Hover · Selected · Disabled · remove">
          <Row label="الحالات">
            <Chip label="كل البنود" />
            <Chip label="فيها فرق" selected={chip} onClick={() => setChip(!chip)} />
            <Chip label="معطّل" disabled />
            <Chip label="الرياض" selected onRemove={() => undefined} />
          </Row>
        </Section>

        <Section id="badge" title="Badge" figma="badge">
          <Row label="Tone"><Badge tone="Success" label="أرسل سعر" /><Badge tone="Warning" label="بانتظار الرد" /><Badge tone="Danger" label="اعتذر" /><Badge tone="Info" label="تم الإرسال" /><Badge tone="Neutral" label="لم يرد" /></Row>
        </Section>

        <Section id="evidence" title="Evidence Badge" figma="evidence-badge" note="يظهر فقط مع حقل حقيقي من الـAPI — غير مستخدم في الشاشات حاليًا">
          <Row label="Level"><EvidenceBadge level="Strong" /><EvidenceBadge level="Medium" /><EvidenceBadge level="Weak" /></Row>
        </Section>

        <Section id="channel" title="Channel Badge" figma="channel-badge" note="Haraj إضافة: قناة حقيقية في الـAPI وغير موجودة في Figma">
          <Row label="Channel"><ChannelBadge channel="WhatsApp" /><ChannelBadge channel="Email" /><ChannelBadge channel="Unreachable" /><ChannelBadge channel="Haraj" /></Row>
        </Section>

        <Section id="stat" title="Stat" figma="stat">
          <div className="grid grid-cols-2 gap-4">
            <Stat label="تم التواصل معهم" value={31} basis="موردين مؤهلين لبنود الطلب" />
            <Stat label="أرسلوا سعر" value={14} basis="يغطّون 46 من 48 بند" tone="Success" />
            <Stat label="بانتظار" value={12} basis="من 31 مورد تم التواصل معهم" tone="Warning" />
            <Stat label="اعتذروا" value={3} basis="2 ما عندهم البند · 1 الكمية كبيرة" tone="Danger" />
          </div>
        </Section>

        <Section id="timeline" title="Timeline Step" figma="timeline-step" note="Active ينبض مرة واحدة عند تغيّر الحالة">
          <ol className="grid grid-cols-2 gap-x-6">
            <TimelineStep title="رفع الطلب" detail="10:42 ص · 48 بند" status="Done" />
            <TimelineStep title="التواصل مع الموردين" detail="تم التواصل مع 31 مورد" status="Active" />
            <TimelineStep title="المقارنة والترسية" detail="بانتظار أول عرض" status="Pending" />
            <TimelineStep title="الإرسال" detail="رقم الواتساب غير صحيح" status="Failed" showConnector={false} />
          </ol>
        </Section>

        <Section id="quote" title="Quote Card" figma="quote-card" note="الحقائق (ضمان/توريد/توصيل) تظهر فقط إذا ذكرها المورد">
          <div className="grid grid-cols-2 gap-4">
            <QuoteCard state="Default" supplier="مستودع الرياض للكهرباء" meta="قبل 25 دقيقة · واتساب" amount={<Money amount={41200} />} amountNote="شامل الضريبة ١٥٪ والتوصيل" coverageLabel="12 من 14 بند" facts={[{ icon: 'truck', label: 'توصيل مجاني' }, { icon: 'clock', label: 'التوريد 3 أيام' }, { icon: 'shield', label: 'ضمان سنة' }]} />
            <QuoteCard state="New" supplier="مؤسسة النور للكهرباء" meta="وصل الحين · إيميل" amount={<Money amount={42500} />} amountNote="شامل الضريبة ١٥٪" facts={[{ icon: 'clock', label: 'التوريد 5 أيام' }]} />
            <QuoteCard state="Best" supplier="شركة الخليج للكابلات" meta="قبل ساعة · واتساب" amount={<Money amount={39850} />} amountNote="قبل الضريبة" />
          </div>
        </Section>

        <Section id="price" title="Price Cell" figma="price-cell">
          <Row label="State">
            <PriceCell state="Best" price={<Money amount={41200} vat="incl" />} delta="الأقل سعرًا" />
            <PriceCell state="Normal" price={<Money amount={42100} vat="incl" />} delta={<bdi dir="ltr">+900.00 <RiyalSign /> (2.2%)</bdi>} />
            <PriceCell state="Higher" price={<Money amount={47000} vat="incl" />} delta={<bdi dir="ltr">+5,800.00 <RiyalSign /> (14.1%)</bdi>} />
            <PriceCell state="Not comparable" price={<Money amount={41200} />} delta="وحدة مختلفة" />
            <PriceCell state="Pending" delta="بانتظار الرد" />
          </Row>
        </Section>

        <Section id="dropzone" title="Dropzone" figma="dropzone" note="الأولى تفاعلية (اسحب ملفًا أو اضغط Enter)">
          <Dropzone onFiles={(f) => setFile(f[0]?.name || null)} state={file ? 'Success' : 'Idle'} fileName={file || undefined} successNote="الملف جاهز — القراءة الفعلية في شاشة 01" />
          <div className="grid grid-cols-2 gap-4">
            <Dropzone state="Uploading" fileName="BOQ-Narjis.xlsx" progress={62} />
            <Dropzone state="Success" fileName="BOQ-Narjis.xlsx" successNote="قرأنا 48 بند — راجعها قبل الإرسال" />
            <Dropzone state="Error" errorNote="الصورة غير واضحة — جرّب صورة أوضح أو ملف Excel" />
            <div className="pointer-events-none"><DragOverDemo /></div>
          </div>
        </Section>

        <Section id="tab" title="Tab" figma="tab" note="الأسهم تتبع RTL: يسار = التالي">
          <Tabs label="تصفية الموردين" value={tab} onChange={setTab} items={[{ key: 'all', label: 'الكل 31' }, { key: 'quoted', label: 'أرسلوا سعر 14' }, { key: 'waiting', label: 'بانتظار 12' }]} />
        </Section>

        <Section id="topbar" title="Top Bar" figma="top-bar" note="البحث والتنبيهات تظهر فقط عند توفر الخاصية">
          <TopBar parent="طلبات التسعير" onParent={() => undefined} title="توريد كهرباء — فيلا النرجس" actions={<><SearchField value="" onChange={() => undefined} /><IconButton icon="bell" label="التنبيهات" /><IconButton icon="moon" label="الوضع الداكن" /></>} />
          <TopBar parent="طلبات التسعير" title="بدون إجراءات" />
        </Section>

        <Section id="nav" title="Nav Item" figma="nav-item">
          <div className="flex w-[232px] flex-col gap-1">
            <NavItem icon="grid" label="Default" />
            <NavItem icon="list" label="Active" active count={3} />
            <NavItem icon="inbox" label="مع عدّاد" count={5} />
          </div>
        </Section>

        <Section id="sidebar" title="Sidebar" figma="sidebar">
          <div className="h-[640px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-default)]">
            <Sidebar className="!h-full" onNewRequest={() => undefined}
              nav={<><NavItem icon="list" label="طلبات التسعير" active count={3} /><NavItem icon="inbox" label="صندوق الوارد" count={5} /><NavItem icon="map-pin" label="الاستهداف" href="#" external /></>}
              footerNav={<NavItem icon="sliders" label="الإعدادات" />}
              account={{ name: 'abdulrhman@farq.sa', onSignOut: () => undefined }} />
          </div>
        </Section>

        <Section id="toast" title="Toast" figma="toast">
          <Toast floating={false} tone="Success" title="وصل عرض جديد" body="مستودع الرياض للكهرباء أرسل سعر لـ 12 بند" onClose={() => undefined} />
          <Toast floating={false} tone="Warning" title="عرض يحتاج مراجعة" body="السعر وصل بالكرتون — تأكد من الوحدة قبل المقارنة" onClose={() => undefined} />
          <Toast floating={false} tone="Error" title="تعذّر الإرسال" body="رقم الواتساب غير صحيح لـ 2 من الموردين" onClose={() => undefined} />
        </Section>

        <Section id="icons" title={`Icons (${ICON_NAMES.length})`}>
          <div className="flex flex-wrap gap-3">
            {ICON_NAMES.map((n) => <span key={n} title={n} className="flex size-10 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border-default)]"><Icon name={n} size={20} /></span>)}
          </div>
        </Section>
      </div>
    </div>
  )
}

/** DragOver is internal to Dropzone; this static copy shows the Figma state for comparison. */
function DragOverDemo() {
  return (
    <div className="flex h-[200px] w-full flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border-2 border-dashed border-[var(--color-border-primary)] bg-[var(--color-bg-primary-subtle)] p-8 text-center">
      <span className="flex size-12 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-bg-surface)] text-[var(--color-icon-primary)]"><Icon name="upload" size={24} /></span>
      <span className="text-[16px] leading-[26px] font-medium">أفلت الملف هنا</span>
      <span className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">بنقرأ البنود تلقائيًا</span>
    </div>
  )
}

export function mountGallery() {
  createRoot(document.getElementById('root')!).render(<Gallery />)
}
