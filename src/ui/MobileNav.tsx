import { cx, FOCUS_RING } from './cx'
import { Icon, IconFrom, type IconSource } from './Icon'

/*
 * Mobile App Bar — Figma (55:552): back chevron on the start (right) pointing right,
 * centred title. The bell is omitted until notifications exist.
 * Mobile Bottom Nav — Figma (55:551): 72px, active tab = pill bg-primary-subtle.
 */
export function MobileAppBar({ title, onBack, titleAsText = false }: { title: string; onBack?: () => void; titleAsText?: boolean }) {
  const Title = titleAsText ? 'p' : 'h1'
  return (
    <header className="sticky top-0 z-20 grid h-14 grid-cols-[40px_1fr_40px] items-center border-b border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-2">
      {onBack ? (
        <button type="button" onClick={onBack} aria-label="رجوع" className={cx('flex size-10 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-primary)]', FOCUS_RING)}>
          <Icon name="chevron-back" size={24} />
        </button>
      ) : <span />}
      <Title className="truncate text-center font-[family-name:var(--font-display)] text-[18px] leading-[28px] font-medium">{title}</Title>
      <span />
    </header>
  )
}

export type BottomTab = { label: string; icon: IconSource; active?: boolean; onClick?: () => void; href?: string }

export function MobileBottomNav({ tabs }: { tabs: BottomTab[] }) {
  return (
    <nav aria-label="التنقل الرئيسي" className="fixed inset-x-0 bottom-0 z-20 flex h-[72px] items-center justify-around border-t border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 pt-2 pb-3">
      {tabs.map((t) => {
        const body = (
          <>
            <span className={cx('flex rounded-full px-3.5 py-1', t.active && 'bg-[var(--color-bg-primary-subtle)]')}><IconFrom icon={t.icon} size={22} /></span>
            <span className={cx('text-[12px] leading-[18px] font-medium', t.active ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)]')}>{t.label}</span>
          </>
        )
        const cls = cx('fi-host flex h-[52px] w-[70px] flex-col items-center justify-center gap-1 rounded-[var(--radius-md)]', t.active ? 'text-[var(--color-icon-primary)]' : 'text-[var(--color-icon-secondary)]', FOCUS_RING)
        return t.href
          ? <a key={t.label} href={t.href} target="_blank" rel="noopener noreferrer" className={cls}>{body}<span className="sr-only">(يفتح في نافذة جديدة)</span></a>
          : <button key={t.label} type="button" onClick={t.onClick} aria-current={t.active ? 'page' : undefined} className={cls}>{body}</button>
      })}
    </nav>
  )
}
