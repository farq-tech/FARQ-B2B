'use client'

import { Map as MapIcon, MessageCircle, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { BusinessMap } from '@/components/map/business-map'
import { Button } from '@/components/ui/button'
import { BUSINESSES, businessById, districtById } from '@/lib/mock-data'
import type { Business } from '@/lib/types'

interface BusinessListEditorProps {
  title: string
  cityId: string
  businessIds: string[]
  editable: boolean
  onChange: (ids: string[]) => void
  renderMeta?: (b: Business) => ReactNode
}

export function BusinessListEditor({ title, cityId, businessIds, editable, onChange, renderMeta }: BusinessListEditorProps) {
  const [mapOpen, setMapOpen] = useState(false)
  const businesses = businessIds.map((id) => businessById.get(id)).filter((b): b is Business => Boolean(b))

  const candidates = useMemo(() => {
    const included = new Set(businessIds)
    const categories = new Set(businesses.map((b) => b.category))
    return BUSINESSES.filter(
      (b) => b.cityId === cityId && !b.duplicateOf && !included.has(b.id) && (categories.size === 0 || categories.has(b.category)),
    ).slice(0, 40)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId, businessIds.join(',')])

  const toggle = (id: string) => onChange(businessIds.includes(id) ? businessIds.filter((x) => x !== id) : [...businessIds, id])

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4" aria-labelledby="biz-list-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="biz-list-title" className="font-semibold">
          {title} <span className="text-sm font-normal text-muted-foreground tabular-nums">({businesses.length})</span>
        </h2>
        {editable ? (
          <Button variant="outline" size="sm" onClick={() => setMapOpen((v) => !v)} aria-expanded={mapOpen}>
            <MapIcon data-icon="inline-start" />
            {mapOpen ? 'إخفاء الخريطة' : 'تعديل على الخريطة'}
          </Button>
        ) : null}
      </div>

      {mapOpen && editable ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">اضغط على الدبوس الملوّن لإزالته، أو على الدبوس الباهت لإضافة منشأة مشابهة.</p>
          <BusinessMap
            compact
            cityId={cityId}
            businesses={businesses}
            ghostBusinesses={candidates}
            selectedIds={businessIds}
            onTogglePin={toggle}
            className="h-72"
          />
        </div>
      ) : null}

      {businesses.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">لا توجد منشآت. أضف من الخريطة.</p>
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
        </ul>
      )}
    </section>
  )
}
