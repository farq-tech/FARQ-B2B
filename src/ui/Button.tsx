import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx, FOCUS_RING } from './cx'
import { IconFrom, type IconSource } from './Icon'

/*
 * Button — Figma «Button» (9:110). Props follow Figma: Style · Size · State.
 * Hover / focus-visible / active come from CSS; Disabled and Loading are props.
 * RTL: the icon sits on the start (right) side, so it is rendered first.
 */
export type ButtonStyle = 'Primary' | 'Secondary' | 'Ghost' | 'Danger' | 'Accent'
export type ButtonSize = 'S' | 'M' | 'L'

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> & {
  variant?: ButtonStyle
  size?: ButtonSize
  icon?: IconSource
  loading?: boolean
  loadingLabel?: string
  fullWidth?: boolean
  children?: ReactNode
}

const SIZE: Record<ButtonSize, { box: string; wide: string; text: string; icon: number }> = {
  // Keep the size prop for call-site compatibility; shared platform actions use
  // one compact footprint so buttons stay visually consistent between screens.
  S: { box: 'h-9 px-3 gap-1.5', wide: 'min-h-9 py-1 px-3 gap-1.5', text: 'text-[14px] leading-5', icon: 16 },
  M: { box: 'h-9 px-3 gap-1.5', wide: 'min-h-9 py-1 px-3 gap-1.5', text: 'text-[14px] leading-5', icon: 16 },
  L: { box: 'h-9 px-3 gap-1.5', wide: 'min-h-9 py-1 px-3 gap-1.5', text: 'text-[14px] leading-5', icon: 16 },
}

const STYLE: Record<ButtonStyle, string> = {
  Primary: 'bg-[var(--color-bg-cta)] text-[var(--color-text-on-cta)] enabled:hover:-translate-y-0.5 enabled:hover:shadow-[var(--glow-primary)] enabled:active:translate-y-0',
  Secondary: 'bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] border border-[var(--color-border-strong)] enabled:hover:bg-[var(--color-bg-surface-2)] enabled:active:bg-[var(--color-bg-neutral)]',
  Ghost: 'bg-transparent text-[var(--color-text-link)] enabled:hover:bg-[var(--color-bg-primary-subtle)]',
  Danger: 'bg-[var(--color-bg-danger)] text-[var(--color-text-danger)] enabled:hover:brightness-95',
  Accent: 'bg-[var(--color-bg-brand)] text-[var(--color-text-on-brand)] enabled:hover:-translate-y-0.5 enabled:hover:shadow-[var(--glow-primary)] enabled:active:translate-y-0',
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span aria-hidden className="ui-spin inline-block shrink-0 rounded-full border-2 border-current border-e-transparent" style={{ width: size, height: size }} />
}

export function Button({ variant = 'Primary', size = 'M', icon, loading, loadingLabel = 'جارٍ الإرسال…', fullWidth, disabled, className, children, type = 'button', ...rest }: ButtonProps) {
  const s = SIZE[size]
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx('fi-motion farq-legacy-button', `farq-legacy-button--${variant}`, 'inline-flex shrink-0 items-center justify-center rounded-[var(--radius-md)] font-medium transition-[transform,box-shadow,background-color] duration-150 disabled:cursor-not-allowed', loading ? 'disabled:opacity-100' : 'disabled:opacity-40', fullWidth ? s.wide : s.box, s.text, STYLE[variant], FOCUS_RING, fullWidth ? 'w-full text-center' : 'whitespace-nowrap', className)}
      {...rest}
    >
      {loading ? <Spinner size={16} /> : icon ? <IconFrom icon={icon} size={s.icon} /> : null}
      {fullWidth ? <span className="min-w-0">{loading ? loadingLabel : children}</span> : loading ? loadingLabel : children}
    </button>
  )
}

/** Square icon-only button (Top Bar «Icon button»). Always needs an accessible label. */
export function IconButton({ icon, label, className, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style' | 'children'> & { icon: IconSource; label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={cx('fi-motion inline-flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface-2)] hover:text-[var(--color-text-primary)] disabled:opacity-40', FOCUS_RING, className)} {...rest}>
      <IconFrom icon={icon} size={16} />
    </button>
  )
}
