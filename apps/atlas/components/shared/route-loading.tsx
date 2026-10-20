import { Skeleton } from '@/components/ui/skeleton'

export function RouteLoading({ label }: { label: string }) {
  return (
    <main className="flex flex-1 flex-col gap-6 p-4 lg:p-8" aria-busy="true">
      <span className="sr-only" role="status">
        {`جارٍ تحميل ${label}…`}
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-bold lg:text-2xl">{label}</h1>
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    </main>
  )
}
