import { AlertTriangle, RotateCw } from 'lucide-react'
import { StateMessage } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'

/**
 * A failed load, said plainly, with the way to try again when there is one. Same shape as EmptyState (icon, title,
 * one line, one action), in the compact row by default since it usually sits over a map or inside a panel.
 */
export function LoadError({ what, detail, onRetry, compact = true, className }: {
  what: string
  detail?: string
  onRetry?: () => void
  compact?: boolean
  className?: string
}) {
  return (
    <StateMessage
      role="alert" tone="error" compact={compact} icon={AlertTriangle} className={className}
      title={`تعذر تحميل ${what}.`}
      body={detail ?? (onRetry ? 'تحقق من الاتصال ثم أعد المحاولة.' : undefined)}
      action={onRetry && <Button variant="outline" size="sm" onClick={onRetry}><RotateCw aria-hidden />أعد المحاولة</Button>}
    />
  )
}
