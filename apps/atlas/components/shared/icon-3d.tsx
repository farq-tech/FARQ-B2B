import { cn } from '@/lib/utils'

/** Glossy 3D icons (Microsoft Fluent Emoji 3D, MIT, public/icons/3d): property types and everyday activities. */
const TYPES: Record<string, string> = {
  room: 'room', apartment: 'apartment', floor: 'floor', villa: 'villa', store: 'store', office: 'office', warehouse: 'warehouse', land: 'land',
}
const ACTIVITIES: Record<string, string> = {
  'صيدلية': 'pharmacy', 'مغسلة ملابس': 'laundry', 'بقالة': 'grocery', 'مطعم': 'restaurant', 'صالون حلاقة': 'barber', 'مخبز': 'bakery', 'مقهى': 'cafe',
}

/** The 3D icon for a property type id or an activity's Arabic name; nothing when there is none. */
export function Icon3D({ type, activity, className }: { type?: string; activity?: string; className?: string }) {
  const name = (type && TYPES[type]) || (activity && ACTIVITIES[activity])
  if (!name) return null
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/icons/3d/${name}.png`} alt="" aria-hidden width={128} height={128} draggable={false} className={cn('size-6 shrink-0 select-none object-contain', className)} />
}
