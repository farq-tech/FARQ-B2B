import type { ReactNode } from 'react'

/** The key to the colours a tool paints on the map, from one end of its scale to the other. A tool hands it over
 * in its overlay, and the map shows it in its corner, where the colours are. `title` names what the colours show;
 * when a tool leaves it out, the map titles it with the open step. */
export type Legend = { from: string; to: string; shades: string[]; extra?: { color: string; label: string }; title?: string }

/** A short title over the key, so the corner reads «what is coloured» before «from what to what». */
export function LegendTitle({ children }: { children: ReactNode }) {
  return <p className="text-sm font-bold text-foreground">{children}</p>
}

export function MapLegend({ from, to, shades, extra, title }: Legend) {
  return (
    <div className="flex flex-col gap-1.5" aria-label={title ? `مفتاح الألوان: ${title}` : 'مفتاح الألوان على الخريطة'}>
      {title && <LegendTitle>{title}</LegendTitle>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground">{from}</span>
          <span className="flex gap-0.5" aria-hidden>{shades.map((shade) => <span key={shade} className="h-4 w-7 rounded-sm" style={{ background: shade }} />)}</span>
          <span className="text-muted-foreground">{to}</span>
        </span>
        {extra && <span className="flex items-center gap-1.5"><span className="h-4 w-7 rounded-sm" style={{ background: extra.color }} aria-hidden /><span className="text-muted-foreground">{extra.label}</span></span>}
      </div>
    </div>
  )
}
