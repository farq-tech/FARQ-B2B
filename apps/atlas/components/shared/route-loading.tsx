import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * The placeholder a page shows while it loads, laid out like the page itself: the same width and padding as its
 * <main>, its title at the page-title size, chips, then rows. When the page arrives nothing jumps sideways or down.
 */
export function RouteLoading({ label, width = 'max-w-4xl' }: { label: string; width?: 'max-w-4xl' | 'max-w-6xl' }) {
  return (
    <main className={cn('mx-auto flex w-full flex-1 flex-col gap-5 px-4 py-6 lg:py-8', width)} aria-busy="true">
      <span className="sr-only" role="status">
        {`جارٍ تحميل ${label}…`}
      </span>
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
