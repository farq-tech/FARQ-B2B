'use client'

import Link from 'next/link'
import { MessageCircle, X } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { businessById, districtById } from '@/lib/mock-data'
import type { Business, LiveBusinessSnapshot } from '@/lib/types'

interface BusinessListEditorProps {
  title: string
  cityId: string
  businessIds: string[]
  editable: boolean
  onChange: (ids: string[]) => void
  renderMeta?: (b: Business) => ReactNode
  liveBusinesses?: LiveBusinessSnapshot[]
}

export function BusinessListEditor({ title, cityId, businessIds, editable, onChange, renderMeta, liveBusinesses = [] }: BusinessListEditorProps) {
  const businesses = businessIds.map((id) => businessById.get(id)).filter((b): b is Business => Boolean(b))
  const liveById = useMemo(() => new Map(liveBusinesses.map((business) => [business.id, business])), [liveBusinesses])
  const visibleLiveBusinesses = businessIds.flatMap((id) => liveById.get(id) ? [liveById.get(id)!] : [])
  const totalCount = businesses.length + visibleLiveBusinesses.length

  const toggle = (id: string) => onChange(businessIds.includes(id) ? businessIds.filter((x) => x !== id) : [...businessIds, id])

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4" aria-labelledby="biz-list-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="biz-list-title" className="font-semibold">
          {title} <span className="text-sm font-normal text-muted-foreground tabular-nums">({totalCount})</span>
        </h2>
      </div>

      {totalCount === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">لا توجد منشآت. <Link href="/map" className="font-semibold text-primary underline">اخترها من الخريطة</Link>.</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {businesses.map((b) => (
            <li key={b.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{b.name}</p>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span>{b.role}</span>
                  <span>{districtById.get(b.districtId)?.name}</span>
                  {b.whatsapp ? (
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle className="size-3 text-primary" aria-hidden />
                      واتساب
                    </span>
                  ) : null}
                </p>
              </div>
              {renderMeta?.(b)}
              {editable ? (
                <Button variant="ghost" size="icon-sm" onClick={() => toggle(b.id)} aria-label={`إزالة ${b.name}`}>
                  <X />
                </Button>
              ) : null}
            </li>
          ))}
          {visibleLiveBusinesses.map((b) => (
            <li key={b.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{b.name}</p>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span>{b.category}</span><span>{b.district}</span>
                  {b.whatsapp ? <span className="inline-flex items-center gap-1"><MessageCircle className="size-3 text-primary" aria-hidden />إشارة واتساب</span> : null}
                </p>
                {b.reason ? <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">{b.reason}</p> : null}
              </div>
              {editable ? <Button variant="ghost" size="icon-sm" onClick={() => toggle(b.id)} aria-label={`إزالة ${b.name}`}><X /></Button> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
