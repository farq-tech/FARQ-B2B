import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx, FOCUS_RING } from './cx'
import { Icon, type IconName } from './Icon'

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
  icon?: IconName
  loading?: boolean
  loadingLabel?: string
  fullWidth?: boolean
  children?: ReactNode
}

const SIZE: Record<ButtonSize, { box: string; wide: string; text: string; icon: number }> = {
  S: { box: 'h-8 px-3 gap-1', wide: 'min-h-8 py-1 px-3 gap-1', text: 'text-[14px] leading-[22px]', icon: 16 },
  M: { box: 'h-10 px-4 gap-2', wide: 'min-h-10 py-1.5 px-4 gap-2', text: 'text-[16px] leading-[26px]', icon: 20 },
  L: { box: 'h-12 px-6 gap-2', wide: 'min-h-12 py-2 px-6 gap-2', text: 'text-[16px] leading-[26px]', icon: 20 },
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
      className={cx('farq-legacy-button', `farq-legacy-button--${variant}`, 'inline-flex shrink-0 items-center justify-center rounded-[var(--radius-md)] font-medium transition-[transform,box-shadow,background-color] duration-150 disabled:cursor-not-allowed', loading ? 'disabled:opacity-100' : 'disabled:opacity-40', fullWidth ? s.wide : s.box, s.text, STYLE[variant], FOCUS_RING, fullWidth ? 'w-full text-center' : 'whitespace-nowrap', className)}
      {...rest}
    >
      {loading ? <Spinner size={16} /> : icon ? <Icon name={icon} size={s.icon} /> : null}
      {fullWidth ? <span className="min-w-0">{loading ? loadingLabel : children}</span> : loading ? loadingLabel : children}
    </button>
  )
}

/** Square icon-only button (Top Bar «Icon button»). Always needs an accessible label. */
export function IconButton({ icon, label, className, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style' | 'children'> & { icon: IconName; label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={cx('inline-flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface-2)] hover:text-[var(--color-text-primary)] disabled:opacity-40', FOCUS_RING, className)} {...rest}>
      <Icon name={icon} size={20} />
    </button>
  )
}
