import { AlertTriangle, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** A failed load, said plainly, with the way to try again when there is one. */
export function LoadError({ what, onRetry, className }: { what: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn('flex items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm', className)}>
      <span className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
        تعذر تحميل {what}.
      </span>
      {onRetry && <Button variant="outline" size="sm" onClick={onRetry}><RotateCw aria-hidden />أعد المحاولة</Button>}
    </div>
  )
}
