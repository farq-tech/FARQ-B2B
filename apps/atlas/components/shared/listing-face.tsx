import { ExternalLink } from 'lucide-react'
import { Icon3D } from '@/components/shared/icon-3d'
import { typeLabel } from '@/lib/real-estate'
import { cn } from '@/lib/utils'

/**
 * What stands in a listing's photo slot when it has no photo to show (none in the ad, or every one failed to load):
 * the property type's icon on a quiet tinted panel, its type and key facts, and the ad itself one tap away. It keeps
 * the slot's shape, so a card without a photo lines up with its neighbours and reads as designed, not as broken.
 * It names no outside site: the link says «شاهد الإعلان» only.
 */
export function ListingFace({ type, facts = [], url, size = 'card', className }: {
  type: string
  /** Short facts in reading order (area, rooms…); empty ones are dropped. */
  facts?: (string | null | undefined | false)[]
  url?: string | null
  /** card: a results card; tile: a small comparable square; band: a strip across the top of a window. */
  size?: 'card' | 'tile' | 'band'
  className?: string
}) {
  const line = facts.filter(Boolean).join(' · ')
  const link = url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}
      className={cn('inline-flex items-center gap-1 rounded-full bg-background/90 font-semibold text-primary shadow-sm outline-none ring-1 ring-primary/15 transition-colors hover:bg-background hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring',
        size === 'tile' ? 'px-2 py-0.5 text-xs pointer-coarse:min-h-9' : 'px-3 py-1.5 text-sm pointer-coarse:min-h-11')}>
      <ExternalLink className={size === 'tile' ? 'size-3' : 'size-3.5'} aria-hidden />شاهد الإعلان<span className="sr-only">، يفتح في نافذة جديدة</span>
    </a>
  ) : null
  const panel = 'bg-[radial-gradient(120%_90%_at_50%_0%,color-mix(in_oklab,var(--primary)_14%,transparent),transparent_70%)] bg-muted'

  if (size === 'band') {
    return (
      <div className={cn('flex items-center gap-3 px-3 py-2.5', panel, className)}>
        <Icon3D type={type} className="size-11" />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="text-sm font-bold">{typeLabel(type)}</span>
          <span className="truncate text-xs text-muted-foreground">{line || 'لا صور لهذا الإعلان'}</span>
        </span>
        {link}
      </div>
    )
  }
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 text-center', panel, size === 'tile' ? 'p-2' : 'p-4', className)}>
      <Icon3D type={type} className={size === 'tile' ? 'size-10' : 'size-20 drop-shadow-sm'} />
      {size === 'card' && (
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-bold">{typeLabel(type)}</span>
          {line && <span className="text-xs text-muted-foreground">{line}</span>}
        </span>
      )}
      {link}
      <span className="sr-only">لا صور لهذا الإعلان</span>
    </div>
  )
}
