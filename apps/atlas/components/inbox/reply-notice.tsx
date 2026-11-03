'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { businessName } from '@/lib/business-name'
import { freshReplies, requestFor } from '@/lib/inbox-feed'
import { numberFormat } from '@/lib/insights-api'
import { useAppStore } from '@/lib/store'

/**
 * A short notice when a WhatsApp reply arrives while the person is somewhere else in Atlas, with one tap to it. Only
 * replies that come in after the first feed of the visit are announced, and none while the inbox itself is open.
 */
export function ReplyNotice() {
  const { inbox, requests, repliesVersion } = useAppStore()
  const router = useRouter()
  const pathname = usePathname()
  const seen = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (repliesVersion === 0) return
    const replies = inbox.filter((message) => message.origin === 'whatsapp')
    const fresh = pathname.startsWith('/inbox') ? [] : freshReplies(seen.current, inbox)
    seen.current = new Set(replies.map((message) => message.id))
    if (!fresh.length) return
    const latest = fresh[fresh.length - 1]
    const name = businessName(latest.businessId, requestFor(requests, latest.requestId))
    toast(fresh.length === 1 ? `رد جديد على واتساب من ${name}` : `${numberFormat.format(fresh.length)} ردود جديدة على واتساب`, {
      action: { label: 'افتح', onClick: () => router.push(fresh.length === 1 ? `/inbox?m=${encodeURIComponent(latest.id)}` : '/inbox?f=unread') },
    })
    // keyed by the feed's version: a new feed is the only thing that can bring a new reply
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repliesVersion])
  return null
}
