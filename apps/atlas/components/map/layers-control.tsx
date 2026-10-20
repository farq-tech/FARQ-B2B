'use client'

import { Eye, EyeOff, Layers, RotateCcw } from 'lucide-react'
import { useId } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

export interface LayerState {
  districts: boolean
  streets: boolean
  clusters: boolean
}

export const DEFAULT_LAYERS: LayerState = { districts: true, streets: true, clusters: true }

type LayerKey = keyof LayerState

const LAYER_META: {
  key: LayerKey
  label: string
  hint: string
  on: string
  off: string
  swatch: React.ReactNode
}[] = [
  {
    key: 'districts',
    label: 'الأحياء وكثافة الفرص',
    hint: 'تلوين كل حي حسب تركّز النتائج عند التصغير',
    on: 'ظاهر',
    off: 'مخفي',
    swatch: <span className="size-4 rounded-[3px] border-[1.5px] border-dashed border-primary bg-primary/15" />,
  },
  {
    key: 'streets',
    label: 'شوارع النشاط',
    hint: 'الشوارع التي تضم ٣ منشآت مطابقة أو أكثر',
    on: 'ظاهر',
    off: 'مخفي',
    swatch: <span className="h-1.5 w-5 rounded-full bg-primary" />,
  },
  {
    key: 'clusters',
    label: 'تجميع الدبابيس',
    hint: 'دمج المنشآت المتقاربة في دائرة واحدة مع عددها',
    on: 'مفعّل',
    off: 'معطّل',
    swatch: (
      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground ring-3 ring-primary/20">
        ٥
      </span>
    ),
  },
]

interface LayersControlProps {
  layers: LayerState
  defaults: LayerState
  onChange: (next: LayerState) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function LayersControl({ layers, defaults, onChange, open, onOpenChange }: LayersControlProps) {
  const baseId = useId()
  const activeCount = LAYER_META.filter((l) => layers[l.key]).length
  const isDefault = LAYER_META.every((l) => layers[l.key] === defaults[l.key])

  return (
    <Popover open={open} onOpenChange={(next) => onOpenChange(next)}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="icon"
            aria-label={`طبقات الخريطة، ${activeCount} من ${LAYER_META.length} مفعّلة`}
            className={cn(
              'relative bg-card shadow-sm',
              open && 'border-primary bg-primary/10 text-primary hover:bg-primary/15',
            )}
          />
        }
      >
        <Layers aria-hidden />
        <span
          aria-hidden
          className={cn(
            'absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-bold tabular-nums ring-2 ring-card',
            isDefault ? 'bg-foreground/80 text-background' : 'bg-primary text-primary-foreground',
          )}
        >
          {activeCount}
        </span>
      </PopoverTrigger>

      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        dir="rtl"
        className="w-[min(17rem,calc(100vw-5rem))] gap-0 p-0"
        aria-labelledby={`${baseId}-title`}
      >
        <div className="flex flex-col px-3 py-2.5">
          <span id={`${baseId}-title`} className="text-sm font-semibold">
            طبقات الخريطة
          </span>
          <span className="text-[11px] text-muted-foreground">
            {activeCount} من {LAYER_META.length} مفعّلة
          </span>
        </div>
        <Separator />

        <ul className="flex flex-col p-1.5">
          {LAYER_META.map((meta) => {
            const on = layers[meta.key]
            const inputId = `${baseId}-${meta.key}`
            return (
              <li key={meta.key}>
                <label
                  htmlFor={inputId}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted',
                    !on && 'text-muted-foreground',
                  )}
                >
                  <Checkbox
                    id={inputId}
                    checked={on}
                    onCheckedChange={(checked) => onChange({ ...layers, [meta.key]: checked === true })}
                    aria-describedby={`${inputId}-hint`}
                  />
                  <span
                    aria-hidden
                    className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-lg border bg-map-land transition-opacity',
                      !on && 'opacity-40 grayscale',
                    )}
                  >
                    {meta.swatch}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cn('text-sm font-medium', on && 'text-foreground')}>{meta.label}</span>
                    <span id={`${inputId}-hint`} className="text-[11px] leading-snug text-muted-foreground">
                      {meta.hint}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      'flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold',
                      on ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {on ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                    {on ? meta.on : meta.off}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>

        {!isDefault ? (
          <>
            <Separator />
            <div className="p-1.5">
              <Button variant="ghost" size="sm" className="w-full justify-start text-primary" onClick={() => onChange(defaults)}>
                <RotateCcw aria-hidden />
                استعادة الطبقات الافتراضية
              </Button>
            </div>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
