import type { ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { StateMessage } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'

/**
 * A failed load, said plainly, with the way to try again when there is one. Same shape as EmptyState (icon, title,
 * one line, one action), in the compact row by default since it usually sits over a map or inside a panel. `title`
 * replaces «تعذر تحميل …» for a calculation the viewer asked for (a route, a week plan); `action` replaces
 * «أعد المحاولة» when trying again cannot help (sign in first).
 */
export function LoadError({ what, title, detail, onRetry, action, compact = true, className }: {
  what: string
  title?: string
  detail?: string
  onRetry?: () => void
  action?: ReactNode
  compact?: boolean
  className?: string
}) {
  return (
    <StateMessage
      role="alert" tone="error" compact={compact} icon={AlertTriangle} className={className}
      title={title ?? `تعذر تحميل ${what}.`}
      body={detail ?? (onRetry ? 'تحقق من الاتصال ثم أعد المحاولة.' : undefined)}
      action={action ?? (onRetry && <Button variant="outline" size="sm" onClick={onRetry}><RotateCw aria-hidden />أعد المحاولة</Button>)}
    />
  )
}
