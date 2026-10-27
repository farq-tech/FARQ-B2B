import Link from 'next/link'
import { Building2, FileText, LocateFixed, TrendingUp, Users, type LucideIcon } from 'lucide-react'

const TOOLS: { href: string; icon: LucideIcon; title: string; text: string; who: string }[] = [
  { href: '/market-gaps', icon: TrendingUp, title: 'فجوات السوق', text: 'الأحياء التي فيها سكان أكثر من المنشآت التي تخدمهم لكل نشاط.', who: 'لأصحاب المشاريع والفروع الجديدة' },
  { href: '/insights/around', icon: LocateFixed, title: 'السكان حول موقع', text: 'كم شخصاً ومنشأة حول نقطة تختارها على الخريطة، بدائرة من 250 م إلى 2 كم.', who: 'لقرار فتح فرع' },
  { href: '/insights/growth', icon: Building2, title: 'خريطة النمو', text: 'المباني تحت الإنشاء والجديدة لكل حي: أين يتجه الطلب القادم.', who: 'لموردي البناء والتكييف والأثاث' },
  { href: '/insights/territories', icon: Users, title: 'مناطق المندوبين', text: 'تقسيم المدينة إلى مناطق متجاورة بحصص متساوية من السكان أو المنشآت.', who: 'لمديري المبيعات والتوزيع' },
  { href: '/insights/report', icon: FileText, title: 'تقرير الحي', text: 'ملف كامل لأي حي: السكان والجنس والأعمار والمنشآت والنمو والدخل.', who: 'للعرض على المستثمر أو الإدارة' },
]

export function InsightsHub() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 pb-24 lg:py-10">
      <header>
        <p className="text-sm font-semibold text-primary">رؤى السوق</p>
        <h1 className="mt-1 text-2xl font-bold">أدوات قرار مبنية على السكان والمباني والمنشآت</h1>
      </header>
      <ul className="grid gap-3 sm:grid-cols-2">
        {TOOLS.map(({ href, icon: Icon, title, text, who }) => (
          <li key={href}>
            <Link href={href} className="flex h-full flex-col gap-2 rounded-2xl border bg-card p-5 transition-colors hover:border-primary/60">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" aria-hidden /></span>
              <span className="text-lg font-bold">{title}</span>
              <span className="text-sm leading-7 text-muted-foreground">{text}</span>
              <span className="mt-auto text-xs font-semibold text-primary">{who}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
