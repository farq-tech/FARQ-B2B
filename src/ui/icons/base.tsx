import { useId, type CSSProperties, type ReactNode } from 'react'
import './icons.css'

/*
 * Farq icon system — shared frame.
 * 24×24 grid, 1.75 stroke, round caps and joins, currentColor. Live area 3–21 (circles r 9, squares 18 with r 2–2.5).
 * States (tokens in src/styles/tokens.css): default --farq-icon-default · hover --farq-icon-hover · active --farq-icon-active,
 * with an optional 12% fill of the icon's main shape (parts marked `fi-fill`) when active.
 * Directional icons carry data-mirror and flip in RTL. Hover motion (CSS only, < 400ms, off under reduced motion)
 * moves the parts wrapped in `fi-m`; see icons.css.
 */

export type IconState = 'default' | 'hover' | 'active'
export type IconMotion = 'truck' | 'pin' | 'boxes' | 'rise' | 'bell'

export type FarqIconProps = {
  /** px; defaults to 20 */
  size?: number
  className?: string
  style?: CSSProperties
  /** Accessible name; omit for decorative icons (aria-hidden). */
  label?: string
  /** Active state: green, with the 12% fill unless activeFill is false. */
  active?: boolean
  /** Fill the main shape at 12% when active (default true). */
  activeFill?: boolean
  /** Force a state colour (dev gallery). Usually the host decides: `fi-host` + :hover / aria-current / aria-pressed. */
  state?: IconState
}

type BaseProps = FarqIconProps & { name: string; mirror?: boolean; motion?: IconMotion; children: ReactNode }

export function IconBase({ name, mirror, motion, children, size = 20, className, style, label, active, activeFill = true, state }: BaseProps) {
  const s = active ? 'active' : state
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      className={className ? `farq-icon ${className}` : 'farq-icon'} style={style}
      data-icon={name} data-mirror={mirror || undefined} data-motion={motion} data-state={s} data-fill={activeFill ? undefined : 'off'}
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false"
    >
      {children}
    </svg>
  )
}

/** A mask id that is safe inside url(#…). */
export function useCutId(): string {
  return `fi${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
}

/**
 * Knock-out: everything under `<g mask={url(#id)}>` loses a 1.25px-clear band around `shape`,
 * so an overlapping badge (pin, stamp, arrow circle, slash) reads cleanly on top.
 */
export function Cut({ id, children }: { id: string; children: ReactNode }) {
  return (
    <defs>
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" stroke="none" />
        <g fill="black" stroke="black" strokeWidth={4.25}>{children}</g>
      </mask>
    </defs>
  )
}

/*
 * The Saudi riyal sign — official shape (SAMA, 2025; Unicode U+20C1), viewBox 1124.14 × 1256.39.
 * Never a dollar sign; never «ر.س» drawn as letters inside an icon.
 */
export const RIYAL_W = 1124.14
export const RIYAL_H = 1256.39
export const RIYAL_PATH = 'M699.62 1113.02c-20.06 44.48-33.32 92.75-38.4 143.37l424.51-90.24c20.06-44.47 33.31-92.75 38.4-143.37l-424.51 90.24ZM1085.73 895.8c20.06-44.47 33.32-92.75 38.4-143.37l-330.68 70.33v-135.2l292.27-62.11c20.06-44.47 33.32-92.75 38.4-143.37l-330.68 70.27V66.13c-50.67 28.45-95.67 66.32-132.25 110.99v403.35l-132.25 28.11V0c-50.67 28.44-95.67 66.32-132.25 110.99v525.69l-295.91 62.88c-20.06 44.47-33.33 92.75-38.42 143.37l334.33-71.05v170.26l-358.3 76.14c-20.06 44.47-33.32 92.75-38.4 143.37l375.04-79.7c30.53-6.35 56.77-24.4 73.83-49.24l68.78-101.97v-.02c7.14-10.55 11.3-23.27 11.3-36.97v-149.98l132.25-28.11v270.4l424.53-90.28Z'

/**
 * The riyal sign placed inside a 24-grid icon: top-left (x, y), height h.
 * `weight` adds an outline (px, non-scaling) so the glyph's stems match the 1.75 strokes around it.
 */
export function RiyalGlyph({ x, y, h, weight = 0.5 }: { x: number; y: number; h: number; weight?: number }) {
  const k = h / RIYAL_H
  return (
    <path d={RIYAL_PATH} fill="currentColor" stroke="currentColor" strokeWidth={weight} vectorEffect="non-scaling-stroke"
      transform={`translate(${x} ${y}) scale(${k.toFixed(6)})`} />
  )
}

/** Width of the riyal glyph at height h (for centring). */
export const riyalWidth = (h: number) => (h * RIYAL_W) / RIYAL_H

const r2 = (n: number) => Math.round(n * 100) / 100
const pt = (cx: number, cy: number, r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180
  return `${r2(cx + r * Math.cos(a))} ${r2(cy + r * Math.sin(a))}`
}

/** Gear outline: `teeth` teeth between radii rIn and rOut. */
export function gearPath(cx: number, cy: number, teeth: number, rIn: number, rOut: number, halfIn: number, halfOut: number): string {
  const step = 360 / teeth
  let d = ''
  for (let i = 0; i < teeth; i++) {
    const a = i * step
    d += `${i ? 'L' : 'M'}${pt(cx, cy, rIn, a - halfIn)}L${pt(cx, cy, rOut, a - halfOut)}L${pt(cx, cy, rOut, a + halfOut)}L${pt(cx, cy, rIn, a + halfIn)}`
    d += `A${rIn} ${rIn} 0 0 1 ${pt(cx, cy, rIn, a + step - halfIn)}`
  }
  return `${d}Z`
}

/** Scalloped seal: `n` outward arcs on a circle of radius r. */
export function sealPath(cx: number, cy: number, n: number, r: number, bump: number): string {
  const step = 360 / n
  let d = `M${pt(cx, cy, r, 0)}`
  for (let i = 1; i <= n; i++) d += `A${bump} ${bump} 0 0 1 ${pt(cx, cy, r, i * step)}`
  return `${d}Z`
}
