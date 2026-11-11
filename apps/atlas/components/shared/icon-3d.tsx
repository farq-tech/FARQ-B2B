import { cn } from '@/lib/utils'

/** Farq Atlas 3D icons in public/icons/3d: property types, sectors, and everyday activities. */
const TYPES: Record<string, string> = {
  room: 'room', apartment: 'apartment', floor: 'floor', villa: 'villa', store: 'store', office: 'office', warehouse: 'warehouse', land: 'land',
  'main-food': 'main-food', 'main-agri': 'main-agri', 'main-build': 'main-build', 'main-contract': 'main-contract',
  'main-ind': 'main-ind', 'main-equip': 'main-equip', 'main-elec': 'main-elec', 'main-auto': 'main-auto',
  'main-home': 'main-home', 'main-fashion': 'main-fashion', 'main-beauty': 'main-beauty', 'main-health': 'main-health',
  'main-edu': 'main-edu', 'main-hosp': 'main-hosp', 'main-log': 'main-log', 'main-biz': 'main-biz',
  'main-re': 'main-re', 'main-fin': 'main-fin', 'main-retail': 'main-retail', 'main-energy': 'main-energy',
  'main-sports': 'main-sports', 'main-media': 'main-media', 'main-personal': 'main-personal',
}
const ACTIVITIES: Record<string, string> = {
  'صيدلية': 'pharmacy', 'مغسلة ملابس': 'laundry', 'بقالة': 'grocery', 'مطعم': 'restaurant', 'صالون حلاقة': 'barber', 'مخبز': 'bakery', 'مقهى': 'cafe',
  'محطة وقود': 'fuel', 'صراف آلي': 'atm', 'مغسلة سيارات': 'carwash', 'ورشة': 'workshop', 'بنك': 'bank', 'مسجد': 'mosque',
}

/** The 3D icon for a property/sector id or an activity's Arabic name. Unknown activities use the neutral icon. */
export function Icon3D({ type, activity, className }: { type?: string; activity?: string; className?: string }) {
  const name = (type && TYPES[type]) || (activity && (ACTIVITIES[activity] || 'unknown'))
  if (!name) return null
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/icons/3d/${name}.png`} alt="" aria-hidden width={128} height={128} draggable={false} className={cn('size-6 shrink-0 select-none object-contain', className)} />
}
