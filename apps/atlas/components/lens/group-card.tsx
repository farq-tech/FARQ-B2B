'use client'

import { X } from 'lucide-react'
import { counted, numberFormat } from '@/lib/insights-api'

type Noun = 'business' | 'listing'

/**
 * The card a group of close points opens on the map (businesses on the map's list, listings on «العقار»): how many,
 * the first few named (each opening its own card), and «قرّب» for the rest. Placed beside the group, inside the part of
 * the map in view (`top` to `bottom`, pixels).
 */
export function GroupCard({ count, items, noun, at, top: ceiling, bottom: floor, onOpen, onClose, onExpand }: {
  count: number
  items: { id: string; title: string; sub?: string | null }[]
  noun: Noun
  at: { x: number; y: number; width: number; height: number }
  top: number
  bottom: number
  onOpen: (id: string) => void
  onClose: () => void
  onExpand: () => void
}) {
  const width = Math.min(256, at.width - 16)
  const left = Math.min(Math.max(8, at.x - width / 2), at.width - width - 8)
  const height = 64 + items.length * (items.some((item) => item.sub) ? 44 : 30) + 44
  const wanted = at.y - 12 - height >= ceiling ? at.y - 12 - height : at.y + 12
  const top = Math.max(ceiling, Math.min(wanted, floor - height))
  const more = count - items.length
  return (
    <section aria-label={`${counted(count, noun)} في هذا المكان`} className="absolute z-[7] flex flex-col gap-1.5 rounded-xl border bg-card/95 p-3 text-sm shadow-lg backdrop-blur" style={{ left, width, top }}>
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-base font-bold">{counted(count, noun)} هنا</h2>
        <button onClick={onClose} aria-label="إغلاق" className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"><X className="size-4" aria-hidden /></button>
      </div>
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => onOpen(item.id)} className="flex w-full flex-col rounded-md px-1 py-1 text-start outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60">
              <span className="truncate font-medium">{item.title}</span>
              {item.sub && <span className="truncate text-xs text-muted-foreground">{item.sub}</span>}
            </button>
          </li>
        ))}
      </ul>
      <button onClick={onExpand} className="mt-1 self-start rounded-full bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/60">
        {more > 0 ? `قرّب لترى الباقي (${numberFormat.format(more)})` : 'قرّب'}
      </button>
    </section>
  )
}
