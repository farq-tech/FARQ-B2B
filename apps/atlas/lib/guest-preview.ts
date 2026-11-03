/**
 * What a signed-out visitor sees of a business search (docs/atlas-product-foundation.md: contact stays inside Atlas,
 * for signed-in accounts only). The count of matching businesses and the first few names, each with its district and
 * activity — no id, phone, WhatsApp, email, address or coordinates, and never more than GUEST_PREVIEW rows. Built on
 * the server from the directory's answer, so the response itself cannot carry more than the panel shows.
 */
export const GUEST_PREVIEW = 3

export type GuestPreviewRow = { name: string; district: string; category: string }
export type GuestPreview = { guest: true; total: number; rows: GuestPreviewRow[] }

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function guestPreview(rows: unknown, total: unknown): GuestPreview {
  const list = Array.isArray(rows) ? rows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object')) : []
  const open = list.filter((row) => row.status !== 'closed_permanent' && text(row.poi_key, 180))
  const preview = open.slice(0, GUEST_PREVIEW).map((row) => ({
    name: text(row.name_ar, 180) || text(row.name_en, 180) || 'منشأة غير مسماة',
    district: text(row.district_ar, 120),
    category: text(row.category_ar, 120) || text(row.category, 120) || 'غير مصنّف',
  }))
  return { guest: true, total: typeof total === 'number' && Number.isFinite(total) && total >= 0 ? Math.floor(total) : open.length, rows: preview }
}
