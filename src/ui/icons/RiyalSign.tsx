import type { CSSProperties } from 'react'
import { RIYAL_H, RIYAL_PATH, RIYAL_W } from './base'

/**
 * الريال السعودي — the official Saudi riyal sign (SAMA 2025, U+20C1) as inline SVG, sized to the text (cap height).
 * Used in: every money amount in place of «ر.س» / «SAR» text — cost lines on خريطة الفرص, the gallery.
 * Never a dollar sign. Screen readers hear «ريال».
 */
export function RiyalSign({ className, style, label = 'ريال' }: { className?: string; style?: CSSProperties; label?: string }) {
  return (
    <svg viewBox={`0 0 ${RIYAL_W} ${RIYAL_H}`} fill="currentColor" role="img" aria-label={label} focusable="false"
      className={className} style={{ display: 'inline-block', width: '0.8em', height: '0.9em', verticalAlign: '-0.05em', flexShrink: 0, ...style }}>
      <path d={RIYAL_PATH} />
    </svg>
  )
}
