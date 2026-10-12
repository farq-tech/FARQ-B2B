import { useEffect, useId, useRef, useState } from 'react'
import { Logo } from '../../../ui/Logo'
import { Icon } from '../../../ui/Icon'
import { cx, FOCUS_RING } from '../../../ui/cx'
import { APP_LOGIN_HREF, START_HREF } from '../contact'
import { Container, LinkButton, T, TextLink } from '../kit'
import HeroScene from './HeroScene'

/* Figma: Nav 33:3 + Hero 47:1714 (desktop) · Hero 60:729 (mobile). Above the fold: no images, text first. */

export const NAV_LINKS = [
  { href: '#how', label: 'كيف تعمل' },
  { href: '#difference', label: 'وش الفرق؟' },
  { href: '#audience', label: 'لمين' },
  { href: '#faq', label: 'الأسئلة' },
] as const

const CATEGORIES = ['احتياجات العيادات', 'تجهيز المطاعم', 'المكاتب', 'الفنادق', 'المقاولات', 'المصانع']

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
            <LinkButton href={START_HREF} variant="Accent" size="M">ابدأ التسعير</LinkButton>
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
            <LinkButton href={START_HREF} variant="Accent" fullWidth>ابدأ التسعير</LinkButton>
          </span>
        </Container>
      </nav>
    </div>
  )
}

/** A quote card from the hero collage (illustrative — no real supplier data). */
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
        <Container className="grid items-center gap-[var(--space-32)] pb-[var(--space-48)] pt-[var(--space-32)] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-[var(--space-48)] lg:pb-[var(--space-64)] lg:pt-[var(--space-64)]">
          <div className="flex min-w-0 flex-col items-start gap-[var(--space-12)]">
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
              اكتب احتياج شركتك أو منشأتك، وراجع البنود قبل تأكيد الطلب. اجمع العروض المستلمة وقارن الأسعار والمواصفات والتوصيل في مكان واحد.
            </p>
            <div className="flex flex-wrap gap-[var(--space-12)] pt-[var(--space-16)]">
              <LinkButton href={START_HREF} variant="Accent" icon="arrow-forward">ابدأ التسعير</LinkButton>
              <LinkButton href="#how" variant="Secondary">شاهد كيف تعمل</LinkButton>
            </div>
          </div>
          <HeroScene />
        </Container>
        <Container className="pb-[var(--space-48)]">
          <ul aria-label="أمثلة احتياجات المنشآت" className="flex flex-wrap items-center gap-x-[var(--space-24)] gap-y-[var(--space-8)] text-[16px] leading-[26px] text-[var(--color-text-secondary)]">
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
