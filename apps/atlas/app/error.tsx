'use client'

import Link from 'next/link'
import { AlertTriangle, Map as MapIcon, RotateCw } from 'lucide-react'
import { StateMessage } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'

/**
 * A page that broke while drawing. The technical message stays out of the page (it is English and means nothing to the
 * reader); the reader gets one try-again and the way to the map. Saved requests and drafts live on the device, so a
 * retry loses nothing.
 */
export default function PageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-16">
      <StateMessage heading="h1" icon={AlertTriangle} tone="error" role="alert" title="تعذر عرض هذه الصفحة"
        body="حدث خطأ أثناء عرضها. طلباتك ومسوداتك محفوظة على هذا الجهاز، فأعد المحاولة أو عد إلى الخريطة."
        action={(
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={reset}><RotateCw data-icon="inline-start" />أعد المحاولة</Button>
            <Button variant="outline" nativeButton={false} render={<Link href="/map" />}><MapIcon data-icon="inline-start" />الخريطة</Button>
          </div>
        )} />
    </main>
  )
}
