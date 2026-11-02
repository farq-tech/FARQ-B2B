import Link from 'next/link'
import { Compass, Map as MapIcon } from 'lucide-react'
import { StateMessage } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'

export const metadata = { title: 'الصفحة غير موجودة | فرق أطلس' }

/** A link that leads nowhere: say so in Atlas's own words, and offer the map, where every decision starts. */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-16">
      <StateMessage icon={Compass} title="الصفحة غير موجودة"
        body="ربما تغيّر الرابط أو حُذف ما كان فيه. ابدأ من الخريطة أو من الصفحة الرئيسية."
        action={(
          <div className="flex flex-wrap justify-center gap-2">
            <Button nativeButton={false} render={<Link href="/map" />}><MapIcon data-icon="inline-start" />افتح الخريطة</Button>
            <Button variant="outline" nativeButton={false} render={<Link href="/" />}>الصفحة الرئيسية</Button>
          </div>
        )} />
    </main>
  )
}
