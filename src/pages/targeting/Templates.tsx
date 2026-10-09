import { useEffect, useMemo, useState } from 'react'
import { templateStatus, type TemplateStatus } from '../../api/targetingClient'
import { Badge, Button, Chip, Icon, TopBar, useIsMobile, type BadgeTone } from '../../ui'
import { CATEGORY_LABEL, loadDrafts, type TemplateCategory } from './drafts'

/*
 * «09 · قوالب واتساب» — Figma 54:349. Real rows only:
 *   - the campaign template (farq_outreach_ar) with its live Meta status from GET /template-status;
 *   - drafts saved from the editor (08) in this browser.
 * The service has no endpoint to list every template of the WhatsApp account, nor usage or reply
 * rates, so «آخر استخدام» and «نسبة الرد» show «—» instead of a number.
 */

type Status = 'APPROVED' | 'PENDING' | 'REJECTED' | 'DRAFT' | 'OTHER'
type Row = { key: string; label: string; name: string; category: string; status: Status; raw: string; reason?: string; draft: boolean }

const STATUS: Record<Status, { tone: BadgeTone; label: string }> = {
  APPROVED: { tone: 'Success', label: 'معتمد' },
  PENDING: { tone: 'Warning', label: 'قيد مراجعة Meta' },
  REJECTED: { tone: 'Danger', label: 'مرفوض' },
  DRAFT: { tone: 'Neutral', label: 'مسودة' },
  OTHER: { tone: 'Neutral', label: 'غير موجود' },
}
const FILTERS: { key: 'ALL' | Status; label: string }[] = [
  { key: 'ALL', label: 'الكل' }, { key: 'APPROVED', label: 'معتمد' }, { key: 'PENDING', label: 'قيد المراجعة' }, { key: 'REJECTED', label: 'مرفوض' }, { key: 'DRAFT', label: 'مسودة' },
]
const metaStatus = (s?: string): Status => (s === 'APPROVED' ? 'APPROVED' : s === 'PENDING' || s === 'IN_APPEAL' ? 'PENDING' : s === 'REJECTED' ? 'REJECTED' : 'OTHER')
const metaCategory = (c?: string) => (c && c in CATEGORY_LABEL ? CATEGORY_LABEL[c as TemplateCategory] : c ? c : '—')

export default function TemplatesPage({ onBack, onNew }: { onBack: () => void; onNew: () => void }) {
  const mobile = useIsMobile()
  const [tpl, setTpl] = useState<TemplateStatus | null>(null)
  const [failed, setFailed] = useState(false)
  const [filter, setFilter] = useState<'ALL' | Status>('ALL')
  useEffect(() => { templateStatus().then(setTpl, () => setFailed(true)) }, [])

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    if (tpl) out.push({ key: tpl.name, label: 'رسالة الحملة', name: tpl.name, category: metaCategory(tpl.category), status: metaStatus(tpl.status), raw: tpl.status, reason: tpl.rejected_reason && tpl.rejected_reason !== 'NONE' ? tpl.rejected_reason : undefined, draft: false })
    for (const d of loadDrafts()) out.push({ key: `draft:${d.name}`, label: d.label || d.name, name: d.name, category: CATEGORY_LABEL[d.category], status: 'DRAFT', raw: 'DRAFT', draft: true })
    return out
  }, [tpl])
  const count = (k: 'ALL' | Status) => (k === 'ALL' ? rows.length : rows.filter((r) => r.status === k).length)
  const shown = filter === 'ALL' ? rows : rows.filter((r) => r.status === filter)

  return (
    <div className="flex min-w-0 flex-col">
      <TopBar parent="الاستهداف" onParent={onBack} title="قوالب واتساب" />
      <div className={mobile ? 'flex flex-col gap-4 px-4 py-5' : 'flex flex-col gap-6 px-8 py-8'}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="font-[family-name:var(--font-display)] text-[32px] leading-[44px] font-semibold">قوالب واتساب</h1>
            <p className="text-[14px] leading-[22px] text-[var(--color-text-secondary)]">كل رسالة أولى لجهة جديدة لازم تكون من قالب معتمد من Meta.</p>
          </div>
          <Button variant="Primary" size="M" icon="plus" onClick={onNew}>قالب جديد</Button>
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="تصفية حسب الحالة">
          {FILTERS.map((f) => <Chip key={f.key} label={`${f.label} ${count(f.key)}`} selected={filter === f.key} onClick={() => setFilter(f.key)} />)}
        </div>

        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
          {mobile ? null : (
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_48px] gap-4 bg-[var(--color-bg-surface-2)] px-5 py-3 text-[12px] leading-[18px] font-medium text-[var(--color-text-secondary)]">
              <span>القالب</span><span>الفئة</span><span>الحالة</span><span>آخر استخدام</span><span>نسبة الرد</span><span />
            </div>
          )}
          {failed ? (
            <p role="alert" className="flex items-center gap-2 px-5 py-4 text-[14px] leading-[22px] text-[var(--color-text-danger)]"><Icon name="alert" size={18} />تعذّر جلب حالة قالب الحملة من خدمة الاستهداف.</p>
          ) : !tpl && !rows.length ? (
            <p role="status" className="px-5 py-4 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">جارٍ التحميل…</p>
          ) : null}
          {shown.map((r) => {
            const st = STATUS[r.status]
            return (
              <div key={r.key} className="border-t border-[var(--color-border-default)] first:border-t-0">
                <div className={mobile ? 'flex flex-col gap-2 px-4 py-4' : 'grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_48px] items-center gap-4 px-5 py-4'}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[16px] leading-[26px] font-medium">{r.label}</span>
                    <span className="truncate text-[12px] leading-[18px] text-[var(--color-text-tertiary)]"><bdi>{r.name}</bdi></span>
                  </span>
                  <span className="text-[14px] leading-[22px]">{r.category}</span>
                  <span><Badge tone={st.tone} label={r.status === 'OTHER' ? `${st.label} (${r.raw})` : st.label} className="text-[12px] leading-[18px]" /></span>
                  <span className="text-[14px] leading-[22px] text-[var(--color-text-tertiary)]" title="ما فيه سجل استخدام في الخدمة">—</span>
                  <span className="text-[14px] leading-[22px] text-[var(--color-text-tertiary)]" title="ما فيه نسبة رد في الخدمة">—</span>
                  <span>{r.draft ? <Button variant="Ghost" size="S" icon="edit" aria-label={`تعديل ${r.label}`} onClick={onNew} /> : null}</span>
                </div>
                {r.reason ? (
                  <p className="flex items-center gap-2 bg-[var(--color-bg-danger)] px-5 py-3 text-[14px] leading-[22px] text-[var(--color-text-danger)]"><Icon name="alert" size={18} />سبب الرفض من Meta: {r.reason}</p>
                ) : null}
              </div>
            )
          })}
          {tpl && !shown.length ? <p className="border-t border-[var(--color-border-default)] px-5 py-4 text-[14px] leading-[22px] text-[var(--color-text-secondary)]">ما فيه قوالب بهذه الحالة.</p> : null}
        </div>
        <p className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">القائمة تعرض قالب الحملة ومسوداتك. عرض كل قوالب حساب واتساب، وآخر استخدام، ونسبة الرد، يحتاج ربط ما هو موجود في الخدمة بعد.</p>
      </div>
    </div>
  )
}
