import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type Shape = 'list' | 'listings' | 'split' | 'form'

/**
 * The placeholder a page shows while it loads, laid out like the page itself, so nothing jumps sideways or down when
 * the page arrives. `shape` picks the page's layout:
 *   list      a title, a chip row and rows (requests, inbox): the same width and padding as its <main>
 *   listings  the search capsule, the type row, then photo cards beside the map (العقار)
 *   split     a questions card beside its answer (سعّر عقارك); stacked on a phone
 *   form      one centred card (تسجيل الدخول)
 */
export function RouteLoading({ label, width = 'max-w-4xl', shape = 'list' }: { label: string; width?: 'max-w-4xl' | 'max-w-5xl' | 'max-w-6xl'; shape?: Shape }) {
  const status = <span className="sr-only" role="status">{`جارٍ تحميل ${label}…`}</span>

  if (shape === 'form') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center p-5" aria-busy="true">
        {status}
        <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border bg-card p-6 shadow-sm" aria-hidden>
          <Skeleton className="mx-auto h-8 w-28" />
          <Skeleton className="mx-auto h-6 w-36" />
          <Skeleton className="mx-auto mb-3 h-4 w-56 max-w-full" />
          <Skeleton className="h-4 w-24" /><Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-4 w-20" /><Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="mt-2 h-10 w-full rounded-lg" />
        </div>
      </main>
    )
  }

  if (shape === 'listings') {
    return (
      <main className="flex h-[calc(100dvh-8rem)] flex-col lg:h-[calc(100dvh-4rem)]" aria-busy="true">
        {status}
        <div className="flex flex-col gap-3 border-b pt-3 pb-2.5" aria-hidden>
          <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4">
            <Skeleton className="h-14 flex-1 rounded-full" /><Skeleton className="size-12 rounded-full" /><Skeleton className="size-12 rounded-full" />
          </div>
          <div className="mx-auto flex w-full max-w-5xl gap-6 overflow-hidden px-4 sm:justify-center">
            {Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="size-11 shrink-0 rounded-xl" />)}
          </div>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]" aria-hidden>
          <div className="flex flex-col gap-4 overflow-hidden px-4 py-4 lg:px-6">
            <Skeleton className="h-7 w-56" />
            <div className="grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex flex-col gap-2"><Skeleton className="aspect-[20/19] rounded-2xl" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /></div>
              ))}
            </div>
          </div>
          <div className="hidden p-4 lg:block"><Skeleton className="h-full rounded-2xl" /></div>
        </div>
      </main>
    )
  }

  if (shape === 'split') {
    return (
      <main className={cn('mx-auto flex w-full flex-col gap-6 px-4 py-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start lg:py-10', width)} aria-busy="true">
        {status}
        <div className="flex flex-col gap-5 rounded-3xl border bg-card p-5 shadow-sm" aria-hidden>
          <h1 className="text-2xl font-bold">{label}</h1>
          <Skeleton className="h-4 w-full" />
          <div className="grid grid-cols-2 gap-3"><Skeleton className="h-11 rounded-lg" /><Skeleton className="h-11 rounded-lg" /></div>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2"><Skeleton className="h-5 w-24" /><div className="flex gap-2"><Skeleton className="h-9 w-20 rounded-lg" /><Skeleton className="h-9 w-24 rounded-lg" /><Skeleton className="h-9 w-16 rounded-lg" /></div></div>
          ))}
        </div>
        <Skeleton className="h-56 rounded-2xl" aria-hidden />
      </main>
    )
  }

  return (
    <main className={cn('mx-auto flex w-full flex-1 flex-col gap-5 px-4 py-6 lg:py-8', width)} aria-busy="true">
      {status}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{label}</h1>
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-24 rounded-lg" />
        <Skeleton className="h-9 w-24 rounded-lg" />
        <Skeleton className="h-9 w-24 rounded-lg" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-20 w-full rounded-2xl" />
      </div>
    </main>
  )
}
