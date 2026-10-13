import type { ButtonHTMLAttributes, ReactNode } from 'react'
import arrow from './assets/farq-action-arrow.svg'
import { cx } from './cx'
import { Spinner } from './Button'
import './farq-production-kit.css'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost'
  loading?: boolean
  loadingLabel?: string
  showIcon?: boolean
  children: ReactNode
}

/** Approved Figma 245:2243; labels wrap without reducing touch targets. */
export function FarqGlassButton({ variant = 'primary', loading = false, loadingLabel = 'جارٍ التحميل…', showIcon = true, children, disabled, className, type = 'button', ...props }: Props) {
  return <button {...props} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={cx('farq-glass-button', `farq-glass-button--${variant}`, className)}>
    <span className="farq-glass-button__label">{loading ? loadingLabel : children}</span>
    {loading ? <Spinner /> : showIcon ? <img src={arrow} width={12} height={12} alt="" aria-hidden /> : null}
  </button>
}
