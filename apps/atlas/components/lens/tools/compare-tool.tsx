'use client'

import { AdvisorPanel } from '../advisor-panel'
import type { DistrictRow } from '../city-data'

/**
 * «قارن حيين»: two districts picked on the map go to the comparison assistant, which asks what the comparison is
 * for and compares them from Atlas figures only.
 */
export function CompareTool({ rows, selected }: { rows: DistrictRow[]; selected: DistrictRow[] }) {
  if (selected.length !== 2) {
    return (
      <section className="rounded-2xl border bg-card p-4">
        <h2 className="text-xl font-bold">قارن حيين</h2>
        <p className="mt-1 text-base text-muted-foreground">
          {selected.length < 2 ? `اختر ${selected.length ? 'حياً ثانياً' : 'حيين'} من الخريطة.` : 'اختر حيين فقط: أزل الزائد بالضغط عليه في الخريطة.'}
        </p>
      </section>
    )
  }
  return <AdvisorPanel key={selected.map((row) => row.id).join('|')} subject={{ kind: 'districts', rows: selected }} rows={rows} />
}
