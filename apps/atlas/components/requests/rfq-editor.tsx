'use client'

import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { makeId } from '@/lib/format'
import type { LineItem, RfqDetails } from '@/lib/types'

interface RfqEditorProps {
  value: RfqDetails
  editable: boolean
  onChange: (v: RfqDetails) => void
}

const fieldClass =
  'h-9 w-full rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/25 disabled:bg-muted/40 disabled:text-foreground'

export function RfqEditor({ value, editable, onChange }: RfqEditorProps) {
  const updateLine = (id: string, patch: Partial<LineItem>) =>
    onChange({ ...value, lineItems: value.lineItems.map((l) => (l.id === id ? { ...l, ...patch } : l)) })

  return (
    <section className="flex flex-col gap-4 rounded-2xl border bg-card p-4" aria-labelledby="rfq-items">
      <div className="flex items-center justify-between">
        <h2 id="rfq-items" className="font-semibold">
          بنود التسعير
        </h2>
        {editable ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onChange({ ...value, lineItems: [...value.lineItems, { id: makeId('l'), name: '', qty: 1, unit: 'حبة', spec: '' }] })}
          >
            <Plus data-icon="inline-start" />
            إضافة بند
          </Button>
        ) : null}
      </div>

      <ol className="flex flex-col gap-3">
        {value.lineItems.map((l, i) => (
          <li key={l.id} className="grid grid-cols-6 gap-2 rounded-xl border bg-background/50 p-3">
            <label className="col-span-6 flex flex-col gap-1 sm:col-span-3">
              <span className="text-xs text-muted-foreground">البند {i + 1}</span>
              <input disabled={!editable} value={l.name} onChange={(e) => updateLine(l.id, { name: e.target.value })} placeholder="اسم المنتج" className={fieldClass} />
            </label>
            <label className="col-span-3 flex flex-col gap-1 sm:col-span-1">
              <span className="text-xs text-muted-foreground">الكمية</span>
              <input
                disabled={!editable}
                type="number"
                min={1}
                inputMode="numeric"
                value={l.qty}
                onChange={(e) => updateLine(l.id, { qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                className={`${fieldClass} tabular-nums`}
              />
            </label>
            <label className="col-span-3 flex flex-col gap-1 sm:col-span-1">
              <span className="text-xs text-muted-foreground">الوحدة</span>
              <input disabled={!editable} value={l.unit} onChange={(e) => updateLine(l.id, { unit: e.target.value })} className={fieldClass} />
            </label>
            <div className="col-span-6 flex items-end justify-end sm:col-span-1">
              {editable && value.lineItems.length > 1 ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`حذف البند ${i + 1}`}
                  onClick={() => onChange({ ...value, lineItems: value.lineItems.filter((x) => x.id !== l.id) })}
                >
                  <Trash2 />
                </Button>
              ) : null}
            </div>
            <label className="col-span-6 flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">المواصفات</span>
              <input disabled={!editable} value={l.spec} onChange={(e) => updateLine(l.id, { spec: e.target.value })} placeholder="المقاس، الخامة، الطباعة…" className={fieldClass} />
            </label>
          </li>
        ))}
      </ol>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">آخر موعد لاستلام العروض</span>
          <input disabled={!editable} type="date" value={value.deadline} onChange={(e) => onChange({ ...value, deadline: e.target.value })} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">مدينة التسليم</span>
          <input disabled={!editable} value={value.deliveryCity} onChange={(e) => onChange({ ...value, deliveryCity: e.target.value })} className={fieldClass} />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">ملاحظات للموردين</span>
        <textarea
          disabled={!editable}
          rows={3}
          value={value.notes}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
          className="rounded-lg border bg-background p-2.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/25 disabled:bg-muted/40"
        />
      </label>
    </section>
  )
}

export function rfqIssues(v: RfqDetails, supplierCount: number) {
  const issues: string[] = []
  if (supplierCount === 0) issues.push('أضف مورداً واحداً على الأقل.')
  if (v.lineItems.some((l) => !l.name.trim())) issues.push('كل بند يحتاج اسماً.')
  if (!v.deadline) issues.push('حدد آخر موعد لاستلام العروض.')
  return issues
}
