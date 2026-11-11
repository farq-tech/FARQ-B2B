'use client'

import { useEffect, useState } from 'react'
import { BookmarkPlus, Link2, Trash2 } from 'lucide-react'
import { AdvisorPanel } from '../advisor-panel'
import type { DistrictRow } from '../city-data'
import { numberFormat } from '@/lib/insights-api'
import { comparisonShareUrl, loadSavedComparisons, persistSavedComparisons, type SavedComparison } from '@/lib/saved-comparisons'

/**
 * «قارن حيين»: two districts picked on the map go to the comparison assistant, which asks what the comparison is
 * for and compares them from Atlas figures only.
 */
export function CompareTool({ rows, selected, city, onRestore }: {
  rows: DistrictRow[]
  selected: DistrictRow[]
  city: string
  onRestore: (city: string, districtIds: string[]) => void
}) {
  const [saved, setSaved] = useState<SavedComparison[]>([])
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [manualShareUrl, setManualShareUrl] = useState('')

  useEffect(() => { setSaved(loadSavedComparisons()) }, [])
  useEffect(() => {
    setManualShareUrl('')
    if (selected.length === 2) setName(`مقارنة ${selected[0].name} و${selected[1].name}`)
  }, [selected])

  const save = () => {
    if (selected.length !== 2) return
    const next: SavedComparison[] = [{ name: name.trim() || `مقارنة ${selected[0].name} و${selected[1].name}`, city, districtIds: selected.map((row) => row.id), savedAt: new Date().toISOString() }, ...saved]
    const unique = next.filter((item, index) => next.findIndex((other) => other.city === item.city && other.districtIds.join('|') === item.districtIds.join('|')) === index).slice(0, 20)
    if (persistSavedComparisons(unique)) {
      setSaved(unique)
      setMessage('حُفظت المقارنة على هذا الجهاز.')
    } else {
      setMessage('تعذر الحفظ في هذا المتصفح؛ لم تُضف المقارنة إلى القائمة.')
    }
  }

  const share = async () => {
    if (selected.length !== 2) return
    const url = comparisonShareUrl(window.location.origin, city, selected.map((row) => row.id))
    try {
      await navigator.clipboard.writeText(url)
      setManualShareUrl('')
      setMessage('نُسخ رابط المقارنة. يفتح البيانات الحالية للأحياء عند مشاركته.')
    } catch {
      setManualShareUrl(url)
      setMessage('تعذر النسخ التلقائي. انسخ الرابط من الحقل أدناه.')
    }
  }

  const remove = (target: SavedComparison) => {
    const next = saved.filter((item) => !(item.city === target.city && item.districtIds.join('|') === target.districtIds.join('|')))
    if (persistSavedComparisons(next)) {
      setSaved(next)
      setMessage('حُذفت المقارنة المحفوظة.')
    } else {
      setMessage('تعذر تحديث الحفظ في هذا المتصفح؛ بقيت المقارنة في القائمة.')
    }
  }

  if (selected.length !== 2) {
    return (
      <section className="rounded-2xl border bg-card p-4">
        <h2 className="text-xl font-bold">قارن حيين</h2>
        <p className="mt-1 text-base text-muted-foreground">
          {selected.length < 2 ? `اختر ${selected.length ? `${numberFormat.format(selected.length)} حياً ثانياً` : 'حيين'} من الخريطة.` : 'اختر حيين فقط: أزل الزائد بالضغط عليه في الخريطة.'}
        </p>
        <SavedList saved={saved} onRestore={onRestore} onRemove={remove} />
        {message && <p role="status" className="mt-2 break-all text-sm text-muted-foreground">{message}</p>}
      </section>
    )
  }
  return (
    <div className="space-y-3">
      <section className="rounded-2xl border bg-card p-4" aria-label="حفظ ومشاركة المقارنة">
        <h2 className="text-lg font-bold">احفظ المقارنة أو شاركها</h2>
        <p className="mt-1 text-sm text-muted-foreground">الحفظ على هذا الجهاز. الرابط يفتح بيانات أطلس الحالية ولا يضمّن أرقاماً ثابتة.</p>
        <label className="mt-3 block text-sm font-medium" htmlFor="comparison-name">اسم المقارنة</label>
        <input id="comparison-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80}
          className="mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/60" />
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={save} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"><BookmarkPlus className="size-4" aria-hidden />احفظ على هذا الجهاز</button>
          <button type="button" onClick={() => void share()} className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold"><Link2 className="size-4" aria-hidden />انسخ رابط عرض</button>
        </div>
        {message && <p role="status" className="mt-2 break-all text-sm text-muted-foreground">{message}</p>}
        {manualShareUrl && <input aria-label="رابط المقارنة للنسخ اليدوي" readOnly value={manualShareUrl}
          onFocus={(event) => event.currentTarget.select()} className="mt-2 h-11 w-full rounded-lg border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60" />}
        <SavedList saved={saved} onRestore={onRestore} onRemove={remove} />
      </section>
      <AdvisorPanel key={selected.map((row) => row.id).join('|')} subject={{ kind: 'districts', rows: selected }} rows={rows} />
    </div>
  )
}

function SavedList({ saved, onRestore, onRemove }: {
  saved: SavedComparison[]
  onRestore: (city: string, districtIds: string[]) => void
  onRemove: (item: SavedComparison) => void
}) {
  if (!saved.length) return null
  return (
    <div className="mt-4 border-t pt-3">
      <h3 className="text-sm font-bold">مقارنات محفوظة على هذا الجهاز</h3>
      <ul className="mt-2 space-y-1">
        {saved.map((item) => (
          <li key={`${item.city}|${item.districtIds.join('|')}`} className="flex items-center gap-2">
            <button type="button" onClick={() => onRestore(item.city, item.districtIds)} className="min-h-10 min-w-0 flex-1 truncate text-start text-sm font-medium text-primary underline-offset-4 hover:underline">{item.name}</button>
            <button type="button" aria-label={`حذف ${item.name}`} onClick={() => onRemove(item)} className="grid size-10 shrink-0 place-items-center rounded-lg border text-muted-foreground"><Trash2 className="size-4" aria-hidden /></button>
          </li>
        ))}
      </ul>
    </div>
  )
}
