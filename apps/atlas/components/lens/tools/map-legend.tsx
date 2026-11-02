/** The key to the colours a tool paints on the map, from one end of its scale to the other. A tool hands it over
 * in its overlay, and the map shows it in its corner, where the colours are. */
export type Legend = { from: string; to: string; shades: string[]; extra?: { color: string; label: string } }

export function MapLegend({ from, to, shades, extra }: Legend) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" aria-label="مفتاح الألوان على الخريطة">
      <span className="flex items-center gap-1.5">
        <span className="text-muted-foreground">{from}</span>
        <span className="flex gap-0.5" aria-hidden>{shades.map((shade) => <span key={shade} className="h-3 w-6 rounded-sm" style={{ background: shade }} />)}</span>
        <span className="text-muted-foreground">{to}</span>
      </span>
      {extra && <span className="flex items-center gap-1.5"><span className="h-3 w-6 rounded-sm" style={{ background: extra.color }} aria-hidden /><span className="text-muted-foreground">{extra.label}</span></span>}
    </div>
  )
}
