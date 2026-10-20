'use client'

import { ArrowLeft, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GOALS } from '@/lib/goals'
import type { GoalId } from '@/lib/types'

interface GoalPickerProps {
  onSelect: (goal: GoalId) => void
  onOpenAssistant: () => void
}

export function GoalPicker({ onSelect, onOpenAssistant }: GoalPickerProps) {
  return (
    <section aria-labelledby="goal-title" className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10 lg:py-16">
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-primary">خريطة الفرص</p>
        <h1 id="goal-title" className="text-3xl font-bold text-balance lg:text-4xl">
          وش هدفك؟
        </h1>
        <p className="max-w-xl text-pretty leading-relaxed text-muted-foreground">
          اختر هدفك لنجهّز الخريطة والفلاتر المناسبة. نعرض الموردين والمشترين وشوارع النشاط في مدينتك، ثم تحدد المنشآت وتجهّز طلباً للمراجعة.
        </p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {GOALS.map((goal) => (
          <li key={goal.id}>
            <button
              type="button"
              onClick={() => onSelect(goal.id)}
              className="group flex h-full w-full flex-col gap-4 rounded-2xl border bg-card p-5 text-right transition-colors hover:border-primary/50 hover:bg-accent/40 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <goal.icon className="size-5" aria-hidden />
              </span>
              <span className="flex flex-col gap-1">
                <span className="font-semibold">{goal.label}</span>
                <span className="text-sm leading-relaxed text-muted-foreground">{goal.description}</span>
              </span>
              <span className="mt-auto flex items-center gap-1 text-sm font-medium text-primary">
                ابدأ
                <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-1" aria-hidden />
              </span>
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={onOpenAssistant}
            className="flex h-full w-full flex-col gap-4 rounded-2xl border border-dashed bg-transparent p-5 text-right transition-colors hover:border-primary/50 hover:bg-card"
          >
            <span className="flex size-10 items-center justify-center rounded-xl bg-foreground text-background">
              <Sparkles className="size-5" aria-hidden />
            </span>
            <span className="flex flex-col gap-1">
              <span className="font-semibold">اكتب هدفك للمساعد</span>
              <span className="text-sm leading-relaxed text-muted-foreground">
                {'صف ما تحتاجه بالعربي، مثل "أبي موردين كراتين بالجملة في السلي".'}
              </span>
            </span>
          </button>
        </li>
      </ul>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
        <span>لن تُحمّل الخريطة قبل اختيار الهدف لتوفير نتائج أدق.</span>
        <Button variant="link" className="h-auto p-0" onClick={() => onSelect('explore')}>
          تخطَّ واستكشف السوق
        </Button>
      </div>
    </section>
  )
}
