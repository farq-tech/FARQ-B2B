import { useEffect, useId, useRef, useState } from 'react'
import { Logo } from '../../../ui/Logo'
import { Icon } from '../../../ui/Icon'
import { cx, FOCUS_RING } from '../../../ui/cx'
import { APP_LOGIN_HREF, START_HREF } from '../contact'
import { Container, LIGHT_SURFACE, LinkButton, T, TextLink } from '../kit'

/* Figma: Nav 33:3 + Hero 47:1714 (desktop) · Hero 60:729 (mobile). Above the fold: no images, text first. */

export const NAV_LINKS = [
  { href: '#how', label: 'كيف تعمل' },
  { href: '#difference', label: 'وش الفرق؟' },
  { href: '#audience', label: 'لمين' },
  { href: '#faq', label: 'الأسئلة' },
] as const

const CATEGORIES = ['كهرباء', 'سباكة', 'مواد البناء', 'إنارة', 'سلامة', 'أثاث مكتبي', 'HVAC']

function Nav() {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="relative z-20">
      <Container className="flex h-[64px] items-center justify-between md:h-[80px]">
        <a href="#main" aria-label="فرق تسعير — أعلى الصفحة" className={cx('rounded-[var(--radius-sm)]', FOCUS_RING)}>
          <Logo height={40} />
        </a>
        <nav aria-label="الأقسام" className="hidden lg:block">
          <ul className="flex items-center gap-[var(--space-32)] text-[16px] leading-[26px] text-[var(--color-text-secondary)]">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <TextLink href={l.href} className="hover:text-[var(--color-text-primary)]">{l.label}</TextLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-[var(--space-8)]">
          <TextLink href={APP_LOGIN_HREF} className={cx(T.bodyM, 'hidden px-[var(--space-8)] text-[var(--color-text-primary)] sm:inline')}>دخول</TextLink>
          <span className="hidden sm:block">
            <LinkButton href={START_HREF} external variant="Accent" size="M">ابدأ التسعير</LinkButton>
          </span>
          <button
            ref={buttonRef}
            type="button"
            className={cx('inline-flex size-10 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-primary)] lg:hidden', FOCUS_RING)}
            aria-expanded={open}
            aria-controls={menuId}
            aria-label={open ? 'إغلاق القائمة' : 'فتح القائمة'}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name={open ? 'x' : 'list'} size={24} />
          </button>
        </div>
      </Container>
      <nav id={menuId} aria-label="القائمة" hidden={!open} className="border-t border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] lg:hidden">
        <Container className="flex flex-col gap-[var(--space-4)] py-[var(--space-16)]">
          {NAV_LINKS.map((l) => (
            <TextLink key={l.href} href={l.href} onClick={() => setOpen(false)} className={cx(T.body, 'px-[var(--space-8)] py-[var(--space-8)] text-[var(--color-text-primary)]')}>
              {l.label}
            </TextLink>
          ))}
          <TextLink href={APP_LOGIN_HREF} className={cx(T.body, 'px-[var(--space-8)] py-[var(--space-8)] text-[var(--color-text-primary)] sm:hidden')}>دخول</TextLink>
          <span className="mt-[var(--space-8)] block sm:hidden">
            <LinkButton href={START_HREF} external variant="Accent" fullWidth>ابدأ التسعير</LinkButton>
          </span>
        </Container>
      </nav>
    </div>
  )
}

/** A quote card from the hero collage (illustrative — no real supplier data). */
function QuoteMock({ name, meta, price, tag, best, bar }: { name: string; meta: string; price: string; tag: string; best?: boolean; bar: string }) {
  return (
    <div
      className={cx(
        LIGHT_SURFACE,
        'flex w-[340px] flex-col gap-[14px] rounded-[var(--radius-xl)] bg-[var(--color-bg-surface)] px-[22px] py-[var(--space-20)] shadow-[var(--elevation-lg)]',
        best && 'border-2 border-[var(--color-border-success)]',
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-[2px] font-medium">
          <span className="text-[16px] leading-[26px] text-[var(--color-text-primary)]">{name}</span>
          <span className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{meta}</span>
        </div>
        <span className={cx(T.caption, 'rounded-[var(--radius-full)] px-[10px] py-[var(--space-4)]', best ? 'bg-[var(--color-bg-success)] text-[var(--color-text-success)]' : 'bg-[var(--color-bg-surface-2)] text-[var(--color-text-secondary)]')}>{tag}</span>
      </div>
      <span className={cx(T.numL, 'text-[var(--color-text-primary)]')}>{price}</span>
      <div className="h-2 w-full rounded-[4px] bg-[var(--color-bg-surface-2)]">
        <div className={cx('h-2 rounded-[4px]', best ? 'bg-[var(--color-icon-success)]' : 'bg-[var(--color-border-default)]')} style={{ width: bar }} />
      </div>
    </div>
  )
}

/** Hero collage: Figma positions relative to a 560×540 box; scaled down on small screens. Decorative. */
function Collage() {
  return (
    <div aria-hidden="true" className="relative mx-auto h-[300px] w-full max-w-[560px] sm:h-[380px] xl:h-[540px]">
      <div className="absolute left-1/2 top-0 h-[540px] w-[560px] origin-top -translate-x-1/2 scale-[0.55] sm:scale-[0.7] xl:scale-100">
        <div className="absolute end-[7px] top-[90px] rotate-[8deg] opacity-90">
          <QuoteMock name="شركة الخليج للكابلات" meta="التوريد 7 أيام" price="44,800 ر.س" tag="عرض" bar="84%" />
        </div>
        <div className="absolute end-[210px] top-[10px] -rotate-[5deg] opacity-95">
          <QuoteMock name="مؤسسة النور للكهرباء" meta="توصيل 350 ر.س" price="42,500 ر.س" tag="عرض" bar="74%" />
        </div>
        <div className="absolute end-[80px] top-[200px]">
          <QuoteMock name="مستودع الرياض للكهرباء" meta="متوفر · توصيل مجاني" price="41,200 ر.س" tag="الأوفر" best bar="61%" />
        </div>
        <div className="absolute end-[342px] top-[400px] rotate-[4deg] rounded-[20px] bg-[var(--color-bg-brand)] px-[var(--space-24)] py-[var(--space-16)] text-[var(--color-text-on-brand)] shadow-[var(--elevation-lg)]">
          <p className="text-[14px] font-medium leading-[22px]">وش الفرق؟</p>
          <p className={T.numL}>3,600 ر.س</p>
          <p className={T.caption}>أوفر من أعلى عرض بـ 8.0%</p>
        </div>
      </div>
    </div>
  )
}

export function SiteHeader() {
  return (
    <header className="relative bg-[var(--color-bg-canvas)] text-[var(--color-text-primary)]">
      <Nav />
    </header>
  )
}

export function Hero() {
  return (
    <section id="top" aria-labelledby="hero-title" className="relative overflow-hidden bg-[var(--color-bg-canvas)] text-[var(--color-text-primary)]">
        <Container className="grid items-center gap-[var(--space-32)] pb-[var(--space-48)] pt-[330px] lg:grid-cols-2 lg:pb-[var(--space-80)] lg:pt-[170px]">
          <div className="flex flex-col items-start gap-[var(--space-12)]">
            <p className="inline-flex items-center gap-[var(--space-8)] rounded-[var(--radius-full)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-[var(--space-16)] py-[var(--space-8)] text-[14px] font-medium leading-[22px]">
              <span aria-hidden="true" className="size-2 rounded-full bg-[var(--color-bg-brand)]" />
              منصة تسعير لمشتريات الشركات
            </p>
            <h1 id="hero-title" className={T.hero}>
              قبل ما تشتري،
              <br />
              شوف{' '}
              <span className="relative inline-block text-[var(--brand-action-strong)]">
                <span aria-hidden="true" className="absolute inset-x-0 bottom-[0.06em] h-[0.17em] rounded-[7px] bg-[var(--color-bg-brand)] opacity-35" />
                <span className="relative">الفرق.</span>
              </span>
            </h1>
            <p className={cx(T.bodyL, 'max-w-[520px] text-[var(--color-text-secondary)]')}>
              ارفع الكراسة، اكتب الطلبات أو صوّرها — ونجيب لك عروض من موردين حقيقيين، محسوبة شامل التوصيل والضريبة، مرتبة من الأوفر.
            </p>
            <div className="flex flex-wrap gap-[var(--space-12)] pt-[var(--space-16)]">
              <LinkButton href={START_HREF} external variant="Accent" icon="arrow-forward">ابدأ التسعير</LinkButton>
              <LinkButton href="#how" variant="Secondary">شاهد كيف تعمل</LinkButton>
            </div>
          </div>
          <Collage />
        </Container>
        <Container className="pb-[var(--space-48)]">
          <ul aria-label="فئات نسعّرها" className="flex flex-wrap items-center gap-x-[var(--space-24)] gap-y-[var(--space-8)] text-[16px] leading-[26px] text-[var(--color-text-secondary)]">
            {CATEGORIES.map((c, i) => (
              <li key={c} className="flex items-center gap-[var(--space-24)]">
                {i > 0 && <span aria-hidden="true" className="size-1 rounded-full bg-[var(--color-text-secondary)]" />}
                {c}
              </li>
            ))}
          </ul>
        </Container>
    </section>
  )
}
