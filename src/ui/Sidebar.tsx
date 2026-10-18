import type { ReactNode } from 'react'
import { cx, FOCUS_RING } from './cx'
import { IconFrom, type IconSource } from './Icon'
import { LogoutIcon } from './icons'
import BrandMark from '../b2b/Brand'
import { Button } from './Button'

/*
 * Nav Item — Figma «Nav Item» (25:95). State: Default · Hover (CSS) · Active.
 * With a Farq icon (src/ui/icons) the item is an `fi-host`: grey → charcoal on hover → green with a 12% fill when active.
 * Sidebar — Figma «Sidebar» (26:599). Sits on the start (right) edge in RTL, full height.
 */
type NavItemProps = { label: string; icon: IconSource; active?: boolean; count?: number | null; onClick?: () => void; href?: string; external?: boolean }

export function NavItem({ label, icon, active, count, onClick, href, external }: NavItemProps) {
  const cls = cx(
    'fi-host flex h-11 w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-[16px] leading-[26px] transition-colors',
    active ? 'bg-[var(--color-bg-primary-subtle)] font-medium text-[var(--color-text-info)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface-2)] hover:text-[var(--color-text-primary)]',
    FOCUS_RING,
  )
  const body = (
    <>
      {typeof icon === 'string'
        ? <IconFrom icon={icon} size={20} className={active ? 'text-[var(--color-icon-primary)]' : 'text-[var(--color-icon-secondary)]'} />
        : <IconFrom icon={icon} size={20} />}
      <span className="min-w-0 flex-1 truncate text-start">{label}</span>
      {count != null ? <span className={cx('rounded-full px-2 text-[12px] leading-[18px] font-medium', active ? 'bg-[var(--color-bg-primary)] text-[var(--color-text-on-primary)]' : 'bg-[var(--color-bg-neutral)] text-[var(--color-text-secondary)]')}>{count}</span> : null}
      {external ? <span className="sr-only">(يفتح في نافذة جديدة)</span> : null}
    </>
  )
  if (href) return <a href={href} className={cls} aria-current={active ? 'page' : undefined} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{body}</a>
  return <button type="button" onClick={onClick} className={cls} aria-current={active ? 'page' : undefined}>{body}</button>
}

type SidebarProps = {
  nav: ReactNode
  footerNav?: ReactNode
  onNewRequest?: () => void
  account?: { name: string; detail?: string; onSignOut?: () => void }
  className?: string
}

export function Sidebar({ nav, footerNav, onNewRequest, account, className }: SidebarProps) {
  return (
    <aside className={cx('flex h-screen w-[clamp(224px,24vw,264px)] shrink-0 flex-col items-stretch gap-6 border-e border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-6', className)}>
      <div className="flex px-2"><BrandMark /></div>
      {onNewRequest ? <Button variant="Primary" size="L" icon="plus" fullWidth onClick={onNewRequest}>طلب تسعير جديد</Button> : null}
      <nav aria-label="التنقل الرئيسي" className="flex flex-col gap-1">{nav}</nav>
      <div className="flex-1" />
      {footerNav ? <div className="flex flex-col gap-1">{footerNav}</div> : null}
      {account ? (
        <div className="flex items-center gap-3 rounded-[var(--radius-md)] bg-[var(--color-bg-surface-2)] p-3">
          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-primary-subtle)] text-[16px] font-medium text-[var(--color-text-info)]">{(account.name.trim()[0] || 'ف').toUpperCase()}</span>
          <div className="flex min-w-0 flex-1 flex-col items-start text-start">
            <p
              dir={account.name.includes('@') ? 'ltr' : undefined}
              className={cx(
                'max-w-full text-[14px] leading-[22px] font-medium text-[var(--color-text-primary)]',
                account.name.includes('@') ? 'break-all whitespace-normal' : 'truncate',
              )}
            >{account.name}</p>
            {account.onSignOut ? <button type="button" onClick={account.onSignOut} className={cx('fi-host inline-flex items-center gap-1 rounded-[var(--radius-sm)] text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]', FOCUS_RING)}><LogoutIcon size={14} />{account.detail || 'تسجيل الخروج'}</button> : account.detail ? <p className="text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">{account.detail}</p> : null}
          </div>
        </div>
      ) : null}
    </aside>
  )
}
