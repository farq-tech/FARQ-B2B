'use client'

import { Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

/** Puts `text` on the clipboard; the hidden-textarea copy covers browsers without the async clipboard (http, old WebViews). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    let done = false
    try { done = document.execCommand('copy') } catch { /* said below */ }
    area.remove()
    return done
  }
}

/**
 * «انسخ الرابط»: copies the page's address as it is now. The map keeps its whole view in the address (map-query.ts),
 * so the link opens the same city, group, step, activity, districts and shading for whoever it is shared with inside
 * the platform (no export, docs/atlas-product-foundation.md).
 */
export function CopyLinkButton({ className, label, description = 'يفتح الخريطة على ما تراه الآن.' }: { className?: string; /** Words said on every screen size instead of
 * «انسخ الرابط» (shown from lg only), for a button inside a panel rather than over the map. */ label?: string; /** What the copied link reopens, said in the toast. */ description?: string }) {
  const copy = async () => {
    if (await copyText(window.location.href)) toast.success('نُسخ الرابط', { description })
    else toast.error('تعذر نسخ الرابط', { description: 'انسخه من شريط العنوان.' })
  }
  return (
    <button type="button" onClick={copy} aria-label={label ?? 'انسخ الرابط'} title="انسخ رابط ما تراه الآن"
      className={cn('flex h-10 items-center gap-1.5 rounded-full border bg-card/95 px-2.5 text-sm font-semibold text-muted-foreground shadow-sm backdrop-blur transition-colors outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring lg:px-3.5', className)}>
      <Link2 className="size-5 shrink-0" aria-hidden />
      <span className={label ? undefined : 'max-lg:sr-only'}>{label ?? 'انسخ الرابط'}</span>
    </button>
  )
}
