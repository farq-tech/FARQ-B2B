'use client'

import { useState } from 'react'
import { ltr, numberFormat } from '@/lib/insights-api'
import type { PublicDirectoryEntity } from '@/lib/live-directory'
import { openNow, statusLabel, todayHours } from '@/lib/business-status'

const sar = (value: number) => `${numberFormat.format(Math.round(value))} ر.س`

// the directory's free text sometimes carries Arabic-Indic or Persian digits («٩ ص - ١١ م»); Atlas shows 0-9 everywhere
const INDIC = /[٠-٩۰-۹]/g
const latin = (text: string) => text.replace(INDIC, (digit) => String((digit.charCodeAt(0) & 0xf) % 10))
/** A directory text field: a bare count goes through numberFormat, any other text keeps its words with 0-9 digits. */
function fact(text: string): string {
  const plain = latin(text).trim()
  return /^\d[\d,]*$/.test(plain) ? numberFormat.format(Number(plain.replace(/,/g, ''))) : plain
}

// a description longer than this opens folded, so the facts under it are seen without scrolling
const LONG = 220

// a value that is already a web address → a usable https link; a bare handle returns '' (rendered as plain text)
function toHref(value: string): string {
  const v = value.trim()
  if (/^https?:\/\//i.test(v)) return v
  if (/^www\./i.test(v)) return `https://${v}`
  if (/^[\w.-]+\.[a-z]{2,}(?:[/?#].*)?$/i.test(v)) return `https://${v}`
  return ''
}
const SOCIAL_BASE: Record<string, string> = {
  instagram: 'https://instagram.com/', tiktok: 'https://www.tiktok.com/@',
  snapchat: 'https://www.snapchat.com/add/', x: 'https://x.com/',
}
// a social field: a full URL as-is, else a bare «@handle»/«handle» turned into the platform link; otherwise plain text
function socialHref(platform: keyof typeof SOCIAL_BASE, value: string): string {
  const direct = toHref(value)
  if (direct) return direct
  const handle = value.trim().replace(/^@/, '')
  return /^[\w.]+$/.test(handle) ? SOCIAL_BASE[platform] + handle : ''
}

/**
 * One business's directory details, all from Farq (no source is ever named): its official description, delivery-app
 * signals, and the operational facts the directory carries. Only present fields are shown; a missing one is left out,
 * never «0». Contacts are never shown — the directory withholds them from the browser.
 */
// a voted status that is not a definite "open" is better trusted than hours that may be stale, so the live
// «مفتوح الآن» badge is shown only when the business is not voted closed/inactive
const SUPPRESS_LIVE = new Set(['closed_temporary', 'closed_permanent', 'inactive'])

export function BusinessDetail({ row }: { row: PublicDirectoryEntity }) {
  const [open, setOpen] = useState(false)
  const now = new Date()

  // operating status: the voted status as an Arabic line; an unknown or absent vote is «غير متاح», never guessed
  const hasStatus = row.statusVoted != null
  const status = statusLabel(row.statusVoted)
  const lowConfidence = row.statusConfidence === 'low'

  // today's hours and a live open-now badge, computed from the canonical weekly hours in Asia/Riyadh
  const today = todayHours(row.hoursWeek, now)
  const live = openNow(row.hoursWeek, now)
  const showBadge = live != null && !SUPPRESS_LIVE.has(String(row.statusVoted))

  // WhatsApp affordance: shown only when the state is not «not_available» (older releases fall back to the flag)
  const waAvailable = row.whatsappState ? row.whatsappState !== 'not_available' : row.whatsapp === true
  const waVerified = row.whatsappState === 'verified'

  const facts: [string, string][] = []
  if (row.operatingHours) facts.push(['ساعات العمل', fact(row.operatingHours)])
  if (row.paymentMethods) facts.push(['طرق الدفع', fact(row.paymentMethods)])
  if (row.serviceLanguages) facts.push(['لغات الخدمة', fact(row.serviceLanguages)])
  if (row.branchCount) facts.push(['الفروع', fact(row.branchCount)])
  if (row.employeeCount) facts.push(['الموظفون', fact(row.employeeCount)])
  if (row.floor) facts.push(['الدور', fact(row.floor)])
  if (row.buildingUse) facts.push(['استخدام المبنى', fact(row.buildingUse)])

  const delivery: [string, string][] = []
  // in words: «4.5 / 5 (120)» inside an Arabic line read as «5 / 4.5», and the bare «(120)» did not say what it counts
  if (row.deliveryRating != null) delivery.push(['التقييم', `${numberFormat.format(Math.round(row.deliveryRating * 10) / 10)} من 5`])
  if (row.deliveryRating != null && row.deliveryRateCount != null) delivery.push(['عدد التقييمات', numberFormat.format(row.deliveryRateCount)])
  // the directory's review count sits beside a shown rating, never alone (a bare count has nothing to qualify)
  if (row.deliveryRating != null && row.reviewsCount != null) delivery.push(['عدد المراجعات', numberFormat.format(row.reviewsCount)])
  if (row.deliveryFee != null) delivery.push(['رسوم التوصيل', sar(row.deliveryFee)])
  if (row.deliveryMinOrder != null) delivery.push(['أقل طلب', sar(row.deliveryMinOrder)])
  if (row.deliveryEta) delivery.push(['زمن التوصيل', fact(row.deliveryEta)])

  // links and social handles the directory carries; a web address becomes a link, a bare handle its platform link,
  // anything else plain text. Only present values appear — a missing one adds no row.
  const links: { label: string; value: string; href: string }[] = []
  const pushLink = (label: string, value: string | undefined, href: string) => { if (value) links.push({ label, value, href }) }
  pushLink('الموقع الإلكتروني', row.website, row.website ? toHref(row.website) : '')
  pushLink('إنستغرام', row.instagram, row.instagram ? socialHref('instagram', row.instagram) : '')
  pushLink('تيك توك', row.tiktok, row.tiktok ? socialHref('tiktok', row.tiktok) : '')
  pushLink('سناب شات', row.snapchat, row.snapchat ? socialHref('snapchat', row.snapchat) : '')
  pushLink('إكس', row.xLink, row.xLink ? socialHref('x', row.xLink) : '')
  pushLink('فيسبوك', row.facebook, row.facebook ? toHref(row.facebook) : '')
  pushLink('لينكدإن', row.linkedin, row.linkedin ? toHref(row.linkedin) : '')
  pushLink('القائمة', row.menuLink, row.menuLink ? toHref(row.menuLink) : '')
  pushLink('الطلب', row.orderLink, row.orderLink ? toHref(row.orderLink) : '')
  pushLink('الحجز', row.reservationLink, row.reservationLink ? toHref(row.reservationLink) : '')
  const extraPhones = row.extraPhones ?? []

  // address: the Arabic full address if present, else English; the national address and postal code are added when present
  const fullAddress = row.fullAddressAr || row.fullAddressEn || ''
  const address: [string, string][] = []
  if (row.nationalAddress) address.push(['العنوان الوطني', row.nationalAddress])
  if (row.postalCode) address.push(['الرمز البريدي', fact(row.postalCode)])
  const hasAddress = Boolean(fullAddress) || address.length > 0

  const description = row.description ? latin(row.description) : ''
  // the English description only adds value when it is not simply the Arabic one shown above
  const descriptionEnText = row.descriptionEn ? latin(row.descriptionEn) : ''
  const secondaryEn = description && descriptionEnText && descriptionEnText !== description ? descriptionEnText : ''
  const mainDescription = description || descriptionEnText
  const folded = mainDescription.length > LONG && !open
  const hasHours = today != null
  const empty = !mainDescription && facts.length === 0 && delivery.length === 0 && !hasStatus && !hasHours && !waAvailable && links.length === 0 && extraPhones.length === 0 && !hasAddress
  return (
    <div className="mb-2 flex flex-col gap-2.5 rounded-lg border bg-muted/30 p-3 text-sm">
      {(hasStatus || hasHours || waAvailable) && (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {hasStatus && (
              <span className={`font-semibold ${status && !lowConfidence ? '' : 'text-muted-foreground'}`}>
                {status ?? 'غير متاح'}
                {status && lowConfidence && <span className="ms-1 text-xs font-normal text-muted-foreground"> (غير مؤكد)</span>}
              </span>
            )}
            {showBadge && live && (
              <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${live.open ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                {live.open ? (live.until ? `مفتوح الآن · حتى ${live.until}` : 'مفتوح الآن') : (live.opensAt ? `مغلق الآن · يفتح ${live.opensAt}` : 'مغلق الآن')}
              </span>
            )}
            {waAvailable && (
              <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${waVerified ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                {waVerified ? 'واتساب موثّق' : 'واتساب متاح'}
              </span>
            )}
          </div>
          {hasHours && today && (
            <p className="text-xs text-muted-foreground">
              {`اليوم (${today.day}): `}
              {/* «من 09:00 إلى 23:00»: a bare «09:00 - 23:00» flips its two times inside the Arabic line */}
              {today.intervals.length ? today.intervals.map(([start, end]) => `من ${start} إلى ${end}`).join('، ') : 'مغلق'}
            </p>
          )}
          {row.lastSeenAt && (
            <p className="text-xs text-muted-foreground">
              {/* the date kept whole: after an Arabic word «2026-10-28» reads as «28-10-2026» */}
              {`آخر رصد: ${ltr(row.lastSeenAt)}`}{row.isStale && ' · بيانات قد تكون قديمة'}
            </p>
          )}
        </div>
      )}
      {mainDescription && (
        <div>
          <p className={folded ? 'line-clamp-3 whitespace-pre-line leading-relaxed' : 'whitespace-pre-line leading-relaxed'}>{mainDescription}</p>
          {secondaryEn && !folded && (
            <p dir="ltr" className="mt-1 whitespace-pre-line text-start leading-relaxed text-muted-foreground">{secondaryEn}</p>
          )}
          {mainDescription.length > LONG && (
            <button type="button" onClick={() => setOpen((was) => !was)} aria-expanded={open}
              className="mt-1 rounded-md font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60">
              {open ? 'أقل' : 'اقرأ الوصف كاملاً'}
            </button>
          )}
        </div>
      )}
      {/* label and value in two aligned columns, so a list of facts is scanned, not read line by line */}
      {facts.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {hasAddress && (
        <section aria-label="العنوان" className="flex flex-col gap-1">
          {fullAddress && <p className="leading-relaxed">{row.fullAddressAr ? fullAddress : <span dir="ltr" className="text-start">{fullAddress}</span>}</p>}
          {address.length > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {address.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-medium">{ltr(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      )}
      {(links.length > 0 || extraPhones.length > 0) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {links.map(({ label, value, href }) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="truncate font-medium">
                {href
                  ? <a href={href} target="_blank" rel="noopener noreferrer nofollow" dir="ltr" className="text-primary hover:underline">{value}</a>
                  : <span dir="ltr" className="text-start">{value}</span>}
              </dd>
            </div>
          ))}
          {extraPhones.length > 0 && (
            <div className="contents">
              <dt className="text-muted-foreground">أرقام إضافية</dt>
              <dd className="flex flex-wrap gap-x-2 gap-y-0.5 font-medium">
                {extraPhones.map((phone) => (
                  <a key={phone} href={`tel:${phone.replace(/[^\d+]/g, '')}`} dir="ltr" className="text-primary hover:underline">{phone}</a>
                ))}
              </dd>
            </div>
          )}
        </dl>
      )}
      {delivery.length > 0 && (
        <section aria-label="التوصيل" className="flex flex-col gap-1.5 rounded-md border bg-background p-2">
          <p className="font-semibold">التوصيل</p>
          <dl className="grid grid-cols-2 gap-1.5">
            {delivery.map(([label, value]) => (
              <div key={label} className="rounded-md bg-muted/40 px-2 py-1">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {empty && <p className="text-muted-foreground">لا تفاصيل إضافية متاحة لهذه المنشأة.</p>}
    </div>
  )
}
