'use client'

import { ArrowUp, CheckCircle2, MapPinned, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { parseQuery, type ParsedQuery } from '@/lib/search'
import { Modal } from '@/components/shared/modal'

const EXAMPLES = [
  'أبي موردين كراتين بالجملة في السلي',
  'مصانع حديد في الصناعية الثانية عندهم واتساب',
  'جهّز طلب تسعير أكياس بلاستيك',
  'مطاعم ومقاهي في العليا لحملة تعريفية',
]

interface AssistantPanelProps {
  open: boolean
  onClose: () => void
  cityId: string
  onApply: (text: string, parsed: ParsedQuery) => void
}

export function AssistantPanel({ open, onClose, cityId, onApply }: AssistantPanelProps) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<{ text: string; parsed: ParsedQuery } | null>(null)
  const [applied, setApplied] = useState(false)

  const reset = () => {
    setPreview(null)
    setApplied(false)
    setText('')
  }

  const interpret = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    setApplied(false)
    setPreview({ text: trimmed, parsed: parseQuery(trimmed, cityId) })
  }

  return (
    <Modal open={open} onClose={onClose} variant="side" title="مساعد البحث" description="صف هدفك بالعربي وسنحوّله إلى فلاتر على الخريطة.">
      <div className="flex h-full flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-muted-foreground">أمثلة</p>
          <div className="flex flex-col gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => {
                  setText(ex)
                  interpret(ex)
                }}
                className="rounded-lg border bg-background px-3 py-2 text-right text-sm hover:border-primary/40 hover:bg-accent/40"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        {preview ? (
          <div className="flex flex-col gap-3 rounded-xl border bg-accent/30 p-3.5" aria-live="polite">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Sparkles className="size-4 text-primary" aria-hidden />
              فهمت طلبك كالتالي
            </p>
            {preview.parsed.chips.length ? (
              <div className="flex flex-wrap gap-1.5">
                {preview.parsed.chips.map((c) => (
                  <span key={c} className="rounded-md bg-card px-2 py-0.5 text-xs font-medium">
                    {c}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">لم أتعرف على تصنيف أو موقع محدد. سأبحث بالكلمات كما هي.</p>
            )}
            <p className="text-xs leading-5 text-muted-foreground">
              سنعرض الجهات المطابقة على الخريطة أولاً. اختر ما يناسبك، ثم حدّد الإجراء من شريط الاختيار.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                className="sm:flex-1"
                onClick={() => {
                  onApply(preview.text, preview.parsed)
                  setApplied(true)
                }}
              >
                <MapPinned data-icon="inline-start" />
                عرض الجهات المطابقة
              </Button>
              <Button
                variant="outline"
                className="sm:flex-1"
                onClick={() => {
                  onApply(preview.text, preview.parsed)
                  reset()
                  onClose()
                }}
              >
                طبّق وأغلق
              </Button>
            </div>
          </div>
        ) : null}

        {applied ? (
          <div className="flex flex-col gap-2.5 rounded-xl border border-primary/30 bg-card p-3.5" aria-live="polite">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <CheckCircle2 className="size-4 text-primary" aria-hidden />
              ظهرت الجهات المطابقة على الخريطة
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              لم نحدد أي جهة ولم ننشئ مسودة. اختر الجهات من النقاط أو القائمة، ثم استخدم شريط الاختيار لتجهيز قائمة أو طلب تسعير أو مسودة حملة.
            </p>
          </div>
        ) : null}

        <form
          className="mt-auto flex items-end gap-2 rounded-xl border bg-background p-2 focus-within:border-primary"
          onSubmit={(e) => {
            e.preventDefault()
            interpret(text)
          }}
        >
          <label htmlFor="assistant-input" className="sr-only">
            اكتب هدفك
          </label>
          <textarea
            id="assistant-input"
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault()
                interpret(text)
              }
            }}
            placeholder="مثال: أبي موزعين مواد غذائية على شارع الستين"
            className="min-h-11 flex-1 resize-none bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button type="submit" size="icon" aria-label="تفسير الطلب" disabled={!text.trim()}>
            <ArrowUp />
          </Button>
        </form>
      </div>
    </Modal>
  )
}
