'use client'

import type { ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  variant?: 'center' | 'side'
}

/** Single entry point for overlays: shadcn Dialog (center) or Sheet (side), with a scrollable body and sticky footer. */
export function Modal({ open, onClose, title, description, children, footer, variant = 'center' }: ModalProps) {
  const onOpenChange = (next: boolean) => {
    if (!next) onClose()
  }

  if (variant === 'side') {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" dir="rtl" className="w-full gap-0 p-0 sm:max-w-[26rem]">
          <SheetHeader className="border-b px-5 py-4 pe-12 text-start">
            <SheetTitle>{title}</SheetTitle>
            {description ? <SheetDescription>{description}</SheetDescription> : null}
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <SheetFooter className="flex-row flex-wrap justify-end border-t px-5 py-3">{footer}</SheetFooter> : null}
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="flex max-h-[90dvh] flex-col gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="border-b px-5 py-4 pe-12 text-start">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <DialogFooter className="m-0 flex-row flex-wrap justify-end rounded-b-xl border-t px-5 py-3">{footer}</DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
