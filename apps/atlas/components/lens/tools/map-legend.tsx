/** The key to the colours a tool paints on the map, from one end of its scale to the other. */
export function MapLegend({ from, to, shades, extra }: { from: string; to: string; shades: string[]; extra?: { color: string; label: string } }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground" aria-label="مفتاح الألوان على الخريطة">
      <span className="flex items-center gap-1.5">
        {from}
        <span className="flex" aria-hidden>{shades.map((shade) => <span key={shade} className="h-3 w-5" style={{ background: shade }} />)}</span>
        {to}
      </span>
      {extra && <span className="flex items-center gap-1.5"><span className="h-3 w-5" style={{ background: extra.color }} aria-hidden />{extra.label}</span>}
    </div>
  )
}
