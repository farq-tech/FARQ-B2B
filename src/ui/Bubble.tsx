import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

export type BubbleVariant = 'default' | 'secondary' | 'muted' | 'tinted' | 'outline' | 'ghost' | 'destructive'
export type BubbleAlign = 'start' | 'end'

const VARIANT: Record<BubbleVariant, string> = {
  default: 'bg-[var(--color-bg-inverse)] text-[var(--color-text-on-inverse)]',
  secondary: 'border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)]',
  muted: 'bg-[var(--color-bg-surface-2)] text-[var(--color-text-primary)]',
  tinted: 'bg-[var(--color-bg-primary-subtle)] text-[var(--color-text-primary)]',
  outline: 'border border-[var(--color-border-default)] bg-transparent text-[var(--color-text-primary)]',
  ghost: 'bg-transparent text-[var(--color-text-primary)]',
  destructive: 'border border-[var(--color-border-danger)] bg-[var(--color-bg-danger)] text-[var(--color-text-danger)]',
}

type BubbleProps = HTMLAttributes<HTMLDivElement> & { variant?: BubbleVariant; align?: BubbleAlign; children?: ReactNode }

/** FARQ-styled implementation of shadcn/ui Bubble's presentational surface. */
export function Bubble({ variant = 'default', align = 'start', className, children, ...props }: BubbleProps) {
  return (
    <div
      data-slot="bubble"
      data-variant={variant}
      data-align={align}
      className={cx('flex w-fit max-w-[80%] min-w-0 flex-col gap-2 rounded-[var(--radius-lg)] px-4 py-3 text-start break-words', align === 'start' ? 'self-start' : 'self-end', VARIANT[variant], className)}
      {...props}
    >
      {children}
    </div>
  )
}

export function BubbleContent({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="bubble-content" className={cx('min-w-0', className)} {...props}>{children}</div>
}

export function BubbleGroup({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="bubble-group" className={cx('flex flex-col gap-2', className)} {...props}>{children}</div>
}

export function BubbleReactions({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="bubble-reactions" className={cx('flex items-center gap-1', className)} {...props}>{children}</div>
}
