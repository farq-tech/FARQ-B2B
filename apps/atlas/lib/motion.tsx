'use client'

/**
 * Atlas motion foundation — one small system every interactive surface reuses, so the site answers a tap the same
 * way everywhere (docs/atlas-product-foundation.md: the map must respond, never distract).
 *
 * Built on framer-motion, over the Tailwind/shadcn system. Three rules keep it honest:
 *   1. Motion only where it clarifies — an acknowledgement, a reveal, a step moving — never decoration.
 *   2. RTL-safe — transforms are translateY/scale/opacity only, never left/right slides that read backwards in Arabic.
 *   3. Reduced-motion first — `useReducedMotion` gates every enter/exit; with it on, state still changes, motion goes.
 *
 * Long lists stay cheap CSS (one container fade, hover on the row): no per-row framer, no `layout` on hundreds of
 * items. These wrappers are for the few things that travel — a detail opening, an action bar arriving, a step sliding.
 */
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'framer-motion'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Durations, in seconds. Three steps, all under the ~450ms a movement reads as «the site, not a wait». */
export const DURATION = { fast: 0.15, base: 0.25, slow: 0.4 } as const
/** One ease curve everywhere: a soft decelerate (out-expo), so things arrive and settle, never bounce or snap. */
export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]
/** The layout spring, for elements that move between places (the step indicator): quick, well-damped, no overshoot. */
export const SPRING: Transition = { type: 'spring', stiffness: 520, damping: 42, mass: 0.9 }

/** The reveal/collapse transition, picked once so every wrapper matches. Reduced motion collapses it to instant. */
export const ease = (reduce: boolean | null): Transition => (reduce ? { duration: 0 } : { duration: DURATION.base, ease: EASE })

export { AnimatePresence, motion, useReducedMotion }

/**
 * Something arriving in place: a gentle fade and a short lift (translateY, so it reads the same in RTL and LTR). With
 * reduced motion it mounts already in its final state — no fade, no lift — the content simply there.
 */
export function Reveal({ children, className, y = 8, delay = 0 }: { children: ReactNode; className?: string; y?: number; delay?: number }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.base, ease: EASE, delay: reduce ? 0 : delay }}
    >
      {children}
    </motion.div>
  )
}

/**
 * A panel that opens and closes under a control (a business's details, in sync with its chevron): height and opacity
 * together, the overflow clipped while it moves. With reduced motion it appears and disappears at once, no sliding.
 */
export function Expand({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  const reduce = useReducedMotion()
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="expand"
          className={cn('overflow-hidden', className)}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={ease(reduce)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
