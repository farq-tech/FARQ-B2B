import { useEffect, useId, useRef, useState } from 'react'
import { Logo } from '../../../ui/Logo'
import { Icon } from '../../../ui/Icon'
import { cx, FOCUS_RING } from '../../../ui/cx'
import { APP_LOGIN_HREF } from '../contact'
import { Container, LinkButton, T, TextLink } from '../kit'
import RequestBox from './RequestBox'
import JourneySim from './JourneySim'

/* Figma: Nav 33:3 + Hero 47:1714 (desktop) · Hero 60:729 (mobile). Above the fold: no images, text first. */

export const NAV_LINKS = [
  { href: '#how', label: 'كيف يعمل' },
  { href: '#compare', label: 'المقارنة' },
  { href: '#sectors', label: 'لكل الأنشطة' },
  { href: '#plans', label: 'الباقات' },
] as const

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
          <Logo height={40} surface="Inverse" />
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
            <LinkButton href="#top" variant="Accent" size="M" onClick={() => window.dispatchEvent(new Event('farq-start'))}>ابدأ الآن</LinkButton>
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
            <LinkButton href="#top" variant="Accent" fullWidth onClick={() => { setOpen(false); window.dispatchEvent(new Event('farq-start')) }}>ابدأ الآن</LinkButton>
          </span>
        </Container>
      </nav>
    </div>
  )
}

/** A quote card from the hero collage (illustrative — no real supplier data). */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-border-default)] bg-[var(--color-bg-canvas)]/85 text-[var(--color-text-primary)] backdrop-blur">
      <Nav />
    </header>
  )
}

export function Hero() {
  return (
    <section id="top" aria-labelledby="hero-title" className="relative text-[var(--color-text-primary)]">
      <Container className="grid items-start gap-[var(--space-32)] pb-[var(--space-48)] pt-[var(--space-24)] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-[var(--space-64)] lg:pb-[var(--space-80)] lg:pt-[var(--space-56,56px)]">
        <div className="flex min-w-0 flex-col items-start gap-[var(--space-16)]">
          <p className="inline-flex items-center gap-[var(--space-8)] rounded-[var(--radius-full)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-[var(--space-12)] py-[6px] text-[14px] font-medium leading-[22px] text-[var(--color-text-secondary)]">
            <span aria-hidden="true" className="size-2 rounded-full bg-[var(--ld-accent)]" />
            منصة تسعير ومقارنة مشتريات الشركات
          </p>
          <h1 id="hero-title" className="font-display text-[clamp(36px,4vw+18px,68px)] font-bold leading-[1.18] text-balance">
            مشتريات شركتك،
            <br />
            <span className="text-[var(--ld-accent-light)]">خلّها علينا.</span>
          </h1>
          <p className={cx(T.bodyL, 'max-w-[600px] text-[var(--color-text-secondary)]')}>
            من مستلزمات التشغيل اليومية إلى المعدات والتجهيزات، فرق يتواصل مع الموردين، يجمع لك عروض الأسعار، ويخليك تقارن وتختار الأنسب، مهما كان نشاط شركتك.
          </p>
          <div className="w-full pt-[var(--space-8)]"><RequestBox /></div>
        </div>
        <JourneySim className="lg:sticky lg:top-[var(--space-24)]" />
      </Container>
    </section>
  )
}
