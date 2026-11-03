import { numberFormat } from '@/lib/insights-api'

export type Understanding = { labels: string[]; more: number } | null | undefined

/** What a typed activity was counted as («مغسلة» -> «مغسلة ملابس»), so a wrong reading is seen and retyped. */
export function Understood({ value }: { value: Understanding }) {
  if (!value?.labels.length) return null
  return (
    <p className="text-sm text-muted-foreground">
      يُحسب ضمن: <span className="font-medium text-foreground">{value.labels.join('، ')}</span>
      {value.more > 0 && ` و${numberFormat.format(value.more)} أخرى`}
    </p>
  )
}
