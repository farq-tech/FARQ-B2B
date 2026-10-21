'use client'

import { ArrowUp, CheckCircle2, FilePen, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { parseQuery, type ParsedQuery } from '@/lib/search'
import type { RequestType } from '@/lib/types'
import { TYPE_LABEL } from '@/lib/format'
import { Modal } from '@/components/shared/modal'

const DRAFT_TYPES: RequestType[] = ['list', 'rfq', 'campaign']

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
  onPrepareDraft: (text: string, parsed: ParsedQuery, type: RequestType) => Promise<{ id: string; count: number; message?: string; login?: boolean }>
  onOpenDraft: (id: string) => void
  defaultType: RequestType
}

export function AssistantPanel({ open, onClose, cityId, onApply, onPrepareDraft, onOpenDraft, defaultType }: AssistantPanelProps) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<{ text: string; parsed: ParsedQuery } | null>(null)
  const [prepared, setPrepared] = useState<{ id: string; count: number; type: RequestType; message?: string; login?: boolean } | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [selectedType, setSelectedType] = useState<RequestType | null>(null)
  const draftType: RequestType = selectedType ?? preview?.parsed.intent ?? defaultType

  const reset = () => {
    setPreview(null)
    setPrepared(null)
    setText('')
    setSelectedType(null)
  }

  const interpret = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    setPrepared(null)
    setSelectedType(null)
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
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">نوع المسودة</p>
              <div role="radiogroup" aria-label="نوع الإجراء" className="grid grid-cols-3 gap-1.5">
                {DRAFT_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={draftType === type}
                    onClick={() => setSelectedType(type)}
                    className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${draftType === type ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:border-primary/40'}`}
                  >
                    {TYPE_LABEL[type]}
                  </button>
                ))}
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                {preview.parsed.intent ? 'استنتجت هذا الخيار من طلبك، ويمكنك تغييره.' : 'اختر الإجراء المناسب قبل تجهيز المسودة.'}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                className="sm:flex-1"
                disabled={preparing}
                onClick={async () => {
                  setPreparing(true)
                  try {
                    const result = await onPrepareDraft(preview.text, preview.parsed, draftType)
                    setPrepared({ ...result, type: draftType })
                  } finally {
                    setPreparing(false)
                  }
                }}
              >
                <FilePen data-icon="inline-start" />
                {preparing ? 'جارٍ تجهيز المسودة…' : `تجهيز ${TYPE_LABEL[draftType]}`}
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
                  جهّزت {TYPE_LABEL[prepared.type]} من {prepared.count} جهة مطابقة للمراجعة
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
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">
                  {prepared.message || 'لم أجد منشآت مطابقة لتجهيز مسودة. جرّب صياغة أوسع أو طبّق المعايير على الخريطة وعدّلها.'}
                </p>
                {prepared.login ? <Link href="/login?next=/opportunity-map" className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">تسجيل الدخول</Link> : null}
              </div>
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
