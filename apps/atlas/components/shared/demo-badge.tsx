import { FlaskConical } from 'lucide-react'
import { cn } from '@/lib/utils'

export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-[11px] font-medium text-warning',
        className,
      )}
    >
      <FlaskConical className="size-3.5" aria-hidden />
      بيانات تجريبية
    </span>
  )
}
