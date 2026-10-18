import type { ReactNode } from 'react'
import { cx, FOCUS_RING } from './cx'
import { IconFrom, type IconSource } from './Icon'
import { LogoutIcon } from './icons'
import BrandMark from '../b2b/Brand'
import { Button, IconButton } from './Button'

/*
 * Nav Item — Figma «Nav Item» (25:95). State: Default · Hover (CSS) · Active.
 * With a Farq icon (src/ui/icons) the item is an `fi-host`: grey → charcoal on hover → green with a 12% fill when active.
 * Sidebar — Figma «Sidebar» (26:599). Sits on the start (right) edge in RTL, full height.
 */
type NavItemProps = { label: string; icon: IconSource; active?: boolean; count?: number | null; onClick?: () => void; href?: string; external?: boolean; collapsed?: boolean }

export function NavItem({ label, icon, active, count, onClick, href, external, collapsed = false }: NavItemProps) {
  const cls = cx(
    'fi-host flex h-11 w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-[16px] leading-[26px] transition-colors',
    collapsed ? 'justify-center px-2' : '',
    active ? 'bg-[var(--color-bg-primary-subtle)] font-medium text-[var(--color-text-info)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface-2)] hover:text-[var(--color-text-primary)]',
    FOCUS_RING,
  )
  const body = (
    <>
      {typeof icon === 'string'
        ? <IconFrom icon={icon} size={20} className={active ? 'text-[var(--color-icon-primary)]' : 'text-[var(--color-icon-secondary)]'} />
        : <IconFrom icon={icon} size={20} />}
      {!collapsed ? <span className="min-w-0 flex-1 truncate text-start">{label}</span> : <span className="sr-only">{label}</span>}
      {!collapsed && count != null ? <span className={cx('rounded-full px-2 text-[12px] leading-[18px] font-medium', active ? 'bg-[var(--color-bg-primary)] text-[var(--color-text-on-primary)]' : 'bg-[var(--color-bg-neutral)] text-[var(--color-text-secondary)]')}>{count}</span> : null}
      {external ? <span className="sr-only">(يفتح في نافذة جديدة)</span> : null}
    </>
  )
  if (href) return <a href={href} title={collapsed ? label : undefined} className={cls} aria-current={active ? 'page' : undefined} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{body}</a>
  return <button type="button" title={collapsed ? label : undefined} onClick={onClick} className={cls} aria-current={active ? 'page' : undefined}>{body}</button>
}

type SidebarProps = {
  nav: ReactNode
  footerNav?: ReactNode
  onNewRequest?: () => void
  account?: { name: string; detail?: string; onSignOut?: () => void }
  collapsed?: boolean
  onToggleCollapsed?: () => void
  className?: string
}

export function Sidebar({ nav, footerNav, onNewRequest, account, collapsed = false, onToggleCollapsed, className }: SidebarProps) {
  return (
    <aside className={cx('flex h-screen shrink-0 flex-col items-stretch gap-6 border-e border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-6 transition-[width] duration-200 motion-reduce:transition-none', collapsed ? 'w-[76px]' : 'w-[clamp(224px,24vw,264px)]', className)}>
      <div className={cx('flex items-center', collapsed ? 'justify-center' : 'justify-between px-2')}>
        {collapsed ? <span title="فرق"><BrandMark height={24} /></span> : <BrandMark />}
        {onToggleCollapsed ? <IconButton icon={collapsed ? 'chevron-back' : 'chevron-forward'} label={collapsed ? 'توسيع القائمة الجانبية' : 'تصغير القائمة الجانبية'} onClick={onToggleCollapsed} className="size-8" /> : null}
      </div>
      {onNewRequest ? collapsed
        ? <IconButton icon="plus" label="طلب تسعير جديد" onClick={onNewRequest} />
        : <Button variant="Primary" size="L" icon="plus" fullWidth onClick={onNewRequest}>طلب تسعير جديد</Button> : null}
      <nav aria-label="التنقل الرئيسي" className="flex flex-col gap-1">{nav}</nav>
      <div className="flex-1" />
      {footerNav ? <div className="flex flex-col gap-1">{footerNav}</div> : null}
      {account && !collapsed ? (
        <div className="flex items-center gap-3 rounded-[var(--radius-md)] bg-[var(--color-bg-surface-2)] p-3">
          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-primary-subtle)] text-[16px] font-medium text-[var(--color-text-info)]">{(account.name.trim()[0] || 'ف').toUpperCase()}</span>
          <div className="flex min-w-0 flex-1 flex-col items-start text-start">
            <p
              title={account.name}
              dir={account.name.includes('@') ? 'ltr' : undefined}
              className="max-w-full truncate whitespace-nowrap text-[14px] leading-[22px] font-medium text-[var(--color-text-primary)]"
            >{account.name}</p>
            {account.onSignOut ? <button type="button" onClick={account.onSignOut} className={cx('fi-host inline-flex items-center gap-1 rounded-[var(--radius-sm)] text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]', FOCUS_RING)}><LogoutIcon size={14} />{account.detail || 'تسجيل الخروج'}</button> : account.detail ? <p className="text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">{account.detail}</p> : null}
          </div>
        </div>
      ) : null}
    </aside>
  )
}
