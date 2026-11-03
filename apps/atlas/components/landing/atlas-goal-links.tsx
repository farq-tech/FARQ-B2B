import Link from 'next/link'
import { ArrowLeft, Compass, Factory, House, Megaphone, Store, Truck } from 'lucide-react'
import { LENS_GOALS, lensById, type LensId } from '@/components/lens/lenses'

/**
 * One card per lens, worded as the map's first-visit row words it (LENS_GOALS), and opening that lens on its first
 * step (`?lens=`). The sixth card is the search at the top of the map, there for every lens. Each line says only what
 * the lens's steps do (components/lens/lenses.ts), never a figure.
 */
const LENS_CARDS: { lens: LensId; text: string; icon: typeof Store }[] = [
  { lens: 'shops', text: 'أين ينقص نشاطك، ومن ينافسك، وأي شارع يناسبك.', icon: Store },
  { lens: 'marketers', text: 'أين يسكن جمهورك، وأي منشآت تصل إليها حملتك.', icon: Megaphone },
  { lens: 'distributors', text: 'قسّم المناطق وخطّط المسار، واعرف أين يُبنى الآن.', icon: Truck },
  { lens: 'analysts', text: 'رتّب الأحياء بأرقامها، وقارن بين حيّين.', icon: Compass },
  { lens: 'property', text: 'شاهد العروض على الخريطة، وتعرّف على حيّها.', icon: House },
]

const goals = [
  ...LENS_CARDS.map(({ lens, text, icon }) => ({ href: `/map?lens=${lens}`, title: LENS_GOALS[lens], text, lands: lensById(lens).label, icon })),
  { href: '/map?goal=find-supplier', title: 'أبحث عن مورد', text: 'اكتب ما تحتاجه في البحث، واطلب التسعير بعد مراجعتك.', lands: 'البحث أعلى الخريطة', icon: Factory },
]

export function AtlasGoalLinks({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3' : 'grid gap-2.5 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3'}>
      {goals.map(({ href, title, text, lands, icon: Icon }) => (
        // on a phone each goal is one row (icon, words, arrow) instead of a tall card: six goals in one screen, not three
        <Link
          key={href}
          href={href}
          className="group flex items-center gap-3 rounded-2xl border bg-card p-4 text-start shadow-sm transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 sm:block sm:p-5"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" aria-hidden /></span>
          <span className="min-w-0 flex-1 sm:block">
            <span className="block font-bold sm:mt-4">{title}</span>
            <span className="mt-0.5 block text-sm leading-6 text-muted-foreground sm:mt-1">{text}</span>
            {/* where the card lands, named as the map names it (the «الفئة» picker, or the search box) */}
            <span className="mt-1 block text-xs font-medium text-primary/80 sm:mt-2">{lands}</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-primary sm:mt-4">
            <span className="max-sm:sr-only">ابدأ</span><ArrowLeft className="size-4 transition-transform group-hover:-translate-x-1" aria-hidden />
          </span>
        </Link>
      ))}
    </div>
  )
}
