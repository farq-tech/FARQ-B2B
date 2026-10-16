/*
 * DEV-ONLY icon gallery: http://localhost:5180/ui/icons (linked from /ui). Not part of `vite build`.
 * Every Farq icon (src/ui/icons) with its Arabic name, where it is used, and the three states
 * (default #616161 · hover #303030 · active #008060 with the 12% fill). Hover a card to see its motion.
 */
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { FARQ_ICONS, RiyalSign, type FarqIconEntry } from '../ui/icons'

const STATES = [['default', 'افتراضي'], ['hover', 'تمرير'], ['active', 'نشط']] as const

function Card({ e }: { e: FarqIconEntry }) {
  const { Icon } = e
  return (
    <li className="fi-host flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 hover:border-[var(--color-border-strong)]" data-testid={`icon-${e.key}`}>
      <div className="flex items-center gap-3">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-bg-surface-2)]"><Icon size={40} /></span>
        <div className="flex min-w-0 flex-col">
          <span className="text-[16px] leading-[24px] font-semibold">{e.ar}</span>
          <code dir="ltr" className="self-end text-[11px] text-[var(--color-text-tertiary)]">{e.key}</code>
        </div>
      </div>
      <div className="flex items-end justify-between gap-2">
        {STATES.map(([s, l]) => (
          <span key={s} className="flex flex-col items-center gap-1">
            <Icon size={24} state={s} />
            <span className="text-[11px] text-[var(--color-text-tertiary)]">{l}</span>
          </span>
        ))}
        <span className="flex flex-col items-center gap-1"><Icon size={16} /><span className="text-[11px] text-[var(--color-text-tertiary)]">16px</span></span>
      </div>
      <p className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">{e.usage}</p>
    </li>
  )
}

/** 96px on the 24 grid with keylines (live area 3–21, circle r 9) — for checking optical balance. */
function Keylines() {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
      {FARQ_ICONS.map(({ key, ar, Icon }) => (
        <li key={key} className="flex flex-col items-center gap-1">
          <span className="relative size-[96px] bg-[var(--color-bg-surface)]">
            <svg aria-hidden viewBox="0 0 24 24" className="absolute inset-0 size-full" fill="none" stroke="var(--color-border-default)" strokeWidth={0.1}>
              {Array.from({ length: 25 }, (_, i) => <path key={i} d={`M${i} 0V24M0 ${i}H24`} />)}
              <rect x="3" y="3" width="18" height="18" stroke="var(--color-border-strong)" />
              <circle cx="12" cy="12" r="9" stroke="var(--color-border-strong)" />
            </svg>
            <Icon size={96} className="relative" />
          </span>
          <span className="text-[12px]">{ar}</span>
        </li>
      ))}
    </ul>
  )
}

function IconGallery() {
  const [dir, setDir] = useState<'rtl' | 'ltr'>('rtl')
  const [grid, setGrid] = useState(() => new URLSearchParams(window.location.search).has('grid'))
  const groups = [...new Set(FARQ_ICONS.map((e) => e.group))]
  if (grid) return (
    <div dir={dir} className="min-h-screen bg-[var(--color-bg-canvas)] p-8 text-[var(--color-text-primary)]">
      <button type="button" onClick={() => setGrid(false)} className="mb-4 rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-1.5 text-[14px]">رجوع للبطاقات</button>
      <Keylines />
    </div>
  )
  return (
    <div dir={dir} className="min-h-screen bg-[var(--color-bg-canvas)] p-8 text-[var(--color-text-primary)]">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col items-start gap-1">
            <a href="/ui" className="text-[14px] text-[var(--color-text-link)] hover:underline">← مكتبة الواجهة</a>
            <h1 className="font-[family-name:var(--font-display)] text-[32px] leading-[48px] font-bold">أيقونات فرق ({FARQ_ICONS.length})</h1>
            <p className="max-w-[760px] text-[14px] leading-[22px] text-[var(--color-text-secondary)]">
              شبكة 24×24، خط 1.75، أطراف ووصلات دائرية، اللون من currentColor. ثلاث حالات: افتراضي، تمرير، نشط (أخضر مع تعبئة 12٪).
              الأيقونات الاتجاهية تنعكس في RTL. مرّر على البطاقة لترى الحركة (الشاحنة، الدبوس، الصناديق، سهم الرفع، الجرس) — تتوقف مع «تقليل الحركة».
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 rounded-full bg-[var(--color-bg-surface)] px-3 py-1.5 text-[14px]">رمز الريال: <bdi>1,250.00</bdi> <RiyalSign /></span>
            <button type="button" onClick={() => setGrid(true)} className="rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-1.5 text-[14px]">شبكة 24 مكبّرة</button>
            <button type="button" onClick={() => setDir(dir === 'rtl' ? 'ltr' : 'rtl')} className="rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-1.5 text-[14px]">الاتجاه: {dir.toUpperCase()}</button>
          </div>
        </header>
        {groups.map((g) => (
          <section key={g} className="flex flex-col gap-3">
            <h2 className="font-[family-name:var(--font-display)] text-[20px] leading-[30px] font-semibold">{g}</h2>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
              {FARQ_ICONS.filter((e) => e.group === g).map((e) => <Card key={e.key} e={e} />)}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

export function mountIconGallery() {
  createRoot(document.getElementById('root')!).render(<IconGallery />)
}
