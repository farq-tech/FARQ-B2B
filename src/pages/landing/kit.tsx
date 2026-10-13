import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { cx, FOCUS_RING } from '../../ui/cx'
import { Icon, type IconName } from '../../ui/Icon'

/*
 * Small landing-only building blocks. Visuals come from src/ui (Button styles, Icon, cx/FOCUS_RING);
 * these exist because the landing CTAs are links (<a>), while src/ui Button renders <button>.
 */

/**
 * Former per-section background slot. The page now has ONE living layer for the whole landing (PageLive, owner
 * 2026-10-08): no copy per section, so this renders nothing. Kept so the sections' markup stays unchanged.
 */
export function LiveBgSlot(props: { tone: 'deep' | 'accent' | 'light'; className?: string }) {
  void props
  return null
}

/** Inside deep (charcoal) sections the shared focus colour (charcoal) would be invisible — switch it to mint. */
export const DEEP_FOCUS = '[--color-border-primary:var(--brand-accent)]'

/** White cards placed inside deep/accent sections: restore the light text tokens the section tone re-pointed. */
export const LIGHT_SURFACE =
  '[--color-text-primary:var(--brand-text)] [--color-text-secondary:var(--brand-text-2)] [--color-bg-canvas:var(--brand-canvas)] [--color-border-primary:var(--brand-action)]'

export type LinkStyle = 'Primary' | 'Accent' | 'Secondary' | 'GhostOnDark'

// Same classes as src/ui Button (Figma «Button» 9:110) — kept in step with Button.tsx STYLE/SIZE.
const LINK_STYLE: Record<LinkStyle, string> = {
  Primary: 'bg-[var(--color-bg-cta)] text-[var(--color-text-on-cta)] hover:-translate-y-0.5 hover:shadow-[var(--glow-primary)]',
  Accent: 'bg-[var(--color-bg-brand)] text-[var(--color-text-on-brand)] hover:-translate-y-0.5 hover:shadow-[var(--glow-primary)]',
  Secondary: 'bg-[var(--color-bg-surface)] text-[var(--brand-text)] border border-[var(--color-border-strong)] hover:bg-[var(--color-bg-surface-2)]',
  GhostOnDark: 'bg-transparent text-[var(--color-text-on-inverse)] border border-[var(--white-a16)] hover:bg-[var(--white-a8)]',
}
const LINK_SIZE = { M: 'min-h-11 px-4 py-2 gap-2', L: 'min-h-12 px-6 py-3 gap-2' } as const

type LinkButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: LinkStyle
  size?: keyof typeof LINK_SIZE
  icon?: IconName
  fullWidth?: boolean
  /** Opens in a new tab (WhatsApp / mail) with rel=noopener. */
  external?: boolean
  children: ReactNode
}

export function LinkButton({ variant = 'Primary', size = 'L', icon, fullWidth, external, className, children, ...rest }: LinkButtonProps) {
  return (
    <a
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : null)}
      className={cx(
        `farq-landing-link farq-landing-link--${variant}` ,
        'inline-flex max-w-full items-center justify-center text-center rounded-[var(--radius-md)] text-[16px] font-medium leading-[26px] transition-[transform,box-shadow,background-color] duration-150 motion-reduce:transition-none motion-reduce:hover:translate-y-0',
        LINK_SIZE[size],
        LINK_STYLE[variant],
        FOCUS_RING,
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {children}
      {icon ? <Icon name={icon} size={20} /> : null}
    </a>
  )
}

/** Text link inside nav/footer. */
export function TextLink({ className, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={cx('rounded-[var(--radius-sm)] hover:underline underline-offset-4', FOCUS_RING, className)} {...rest}>
      {children}
    </a>
  )
}

/** Section container: 1200px content column (Figma 1440 − 2×120), 16px gutters on phones. */
export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('relative mx-auto w-full max-w-[1200px] px-[var(--space-16)] md:px-[var(--space-32)] xl:px-0', className)}>{children}</div>
}

/** Text styles from Figma (Foundations › Typography). */
export const T = {
  hero: 'font-display font-bold text-[clamp(38px,3.4vw+22px,76px)] leading-[1.22] tracking-[-1px] text-balance',
  displayL: 'font-display font-bold text-[28px] leading-[40px] md:text-[40px] md:leading-[60px] md:tracking-[-0.5px]',
  h1: 'font-display font-bold text-[26px] leading-[38px] md:text-[32px] md:leading-[48px]',
  h2: 'font-display font-semibold text-[24px] leading-[36px]',
  h3: 'font-display font-semibold text-[20px] leading-[30px]',
  title: 'font-display font-medium text-[18px] leading-[28px]',
  numL: 'font-display font-semibold text-[28px] leading-[40px]',
  numBase: 'font-display font-semibold text-[16px] leading-[24px]',
  numSmall: 'font-display font-medium text-[14px] leading-[20px]',
  bodyL: 'text-[16px] leading-[26px] md:text-[18px] md:leading-[30px]',
  body: 'text-[16px] leading-[26px]',
  bodyM: 'text-[16px] leading-[26px] font-medium',
  small: 'text-[14px] leading-[22px]',
  smallM: 'text-[14px] leading-[22px] font-medium',
  caption: 'text-[12px] leading-[18px] font-medium',
} as const
