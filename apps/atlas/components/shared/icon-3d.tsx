import { cn } from '@/lib/utils'

/** Farq's own 3D icons (public/icons/3d, docs/design/icon-3d-glass-brief.md): property types, everyday activities and the main activities. */
const TYPES: Record<string, string> = {
  room: 'room', apartment: 'apartment', floor: 'floor', villa: 'villa', store: 'store', office: 'office', warehouse: 'warehouse', land: 'land',
}
const ACTIVITIES: Record<string, string> = {
  'صيدلية': 'pharmacy', 'مغسلة ملابس': 'laundry', 'بقالة': 'grocery', 'مطعم': 'restaurant', 'صالون حلاقة': 'barber', 'مخبز': 'bakery', 'مقهى': 'cafe',
  'محطة وقود': 'fuel', 'صراف آلي': 'atm', 'مغسلة سيارات': 'carwash', 'ورشة': 'workshop', 'بنك': 'bank', 'مسجد': 'mosque',
}
/** The 23 commercial main activities of the Farq taxonomy, by main_id (docs/qa/targeting/taxonomy/farq_taxonomy.json). */
const MAINS = new Set([
  'food', 'agri', 'build', 'contract', 'ind', 'equip', 'elec', 'auto', 'home', 'fashion', 'beauty', 'health',
  'edu', 'hosp', 'log', 'biz', 're', 'fin', 'retail', 'energy', 'sports', 'media', 'personal',
])
/** Non-commercial and unclassified businesses share one neutral icon. */
const NEUTRAL = new Set(['noncom', 'unc'])

/** The 3D icon for a property type id, an activity's Arabic name or a main activity id; nothing when there is none. */
export function Icon3D({ type, activity, main, className }: { type?: string; activity?: string; main?: string; className?: string }) {
  const name = (type && TYPES[type]) || (activity && ACTIVITIES[activity])
    || (main && MAINS.has(main) ? `main-${main}` : main && NEUTRAL.has(main) ? 'unknown' : undefined)
  if (!name) return null
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/icons/3d/${name}.png`} alt="" aria-hidden width={128} height={128} draggable={false} className={cn('size-6 shrink-0 select-none object-contain', className)} />
}
