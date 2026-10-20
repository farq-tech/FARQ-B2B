'use client'

import { ArrowUp, CheckCircle2, FilePen, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { parseQuery, type ParsedQuery } from '@/lib/search'
import type { RequestType } from '@/lib/types'
import { TYPE_LABEL } from '@/lib/format'
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
  onPrepareDraft: (text: string, parsed: ParsedQuery, type: RequestType) => { id: string; count: number } | null
  onOpenDraft: (id: string) => void
  defaultType: RequestType
}

export function AssistantPanel({ open, onClose, cityId, onApply, onPrepareDraft, onOpenDraft, defaultType }: AssistantPanelProps) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<{ text: string; parsed: ParsedQuery } | null>(null)
  const [prepared, setPrepared] = useState<{ id: string; count: number; type: RequestType } | null>(null)
  const draftType: RequestType = preview?.parsed.intent ?? defaultType

  const reset = () => {
    setPreview(null)
    setPrepared(null)
    setText('')
  }

  const interpret = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    setPrepared(null)
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
            <p className="text-sm text-muted-foreground">
              الإجراء المقترح: <span className="font-medium text-foreground">{TYPE_LABEL[draftType]}</span>
              {preview.parsed.intent ? null : ' (افتراضي حسب هدفك)'}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                className="sm:flex-1"
                onClick={() => {
                  const result = onPrepareDraft(preview.text, preview.parsed, draftType)
                  setPrepared(result ? { ...result, type: draftType } : { id: '', count: 0, type: draftType })
                }}
              >
                <FilePen data-icon="inline-start" />
                تجهيز {TYPE_LABEL[draftType]}
              </Button>
              <Button
                variant="outline"
                className="sm:flex-1"
                onClick={() => {
                  onApply(preview.text, preview.parsed)
                  reset()
                }}
              >
                تطبيق على الخريطة فقط
              </Button>
            </div>
          </div>
        ) : null}

        {prepared ? (
          <div className="flex flex-col gap-2.5 rounded-xl border border-primary/30 bg-card p-3.5" aria-live="polite">
            {prepared.id ? (
              <>
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <CheckCircle2 className="size-4 text-primary" aria-hidden />
                  جهّزت {TYPE_LABEL[prepared.type]} من أفضل {prepared.count} نتائج مطابقة
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  المسودة محفوظة ولم يُرسل أي شيء. راجع المنشآت والتفاصيل قبل أي خطوة.
                </p>
                <Button
                  onClick={() => {
                    const id = prepared.id
                    reset()
                    onOpenDraft(id)
                  }}
                >
                  افتح المسودة للمراجعة
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                لم أجد منشآت مطابقة لتجهيز مسودة. جرّب صياغة أوسع أو طبّق المعايير على الخريطة وعدّلها.
              </p>
            )}
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
