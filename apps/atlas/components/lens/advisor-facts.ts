import { numberFormat } from '../../lib/insights-api.ts'
import type { DistrictRow } from './city-data'

/** One figure the comparison assistant is given: its label and the value as shown, «غير متاح» when missing. */
export type Fact = { label: string; value: string }

export const UNAVAILABLE = 'غير متاح'

export const figure = (value: number | null | undefined, unit = '') => (value == null ? UNAVAILABLE : `${numberFormat.format(Math.round(value))}${unit}`)

/**
 * A district's Atlas figures, in the order the assistant reads them and the person sees them. The same list builds
 * the line sent to the assistant and the table under «الأرقام التي يقارن بها», so the two can never disagree.
 */
export function districtPairs(row: Pick<DistrictRow, 'population' | 'businesses' | 'residentsPerBusiness' | 'income' | 'villaShare' | 'underConstruction' | 'realEstate'>): Fact[] {
  const median = (key: string) => figure(row.realEstate[key]?.median, ' ريال')
  return [
    { label: 'السكان', value: figure(row.population) },
    { label: 'المنشآت', value: figure(row.businesses) },
    { label: 'ساكن لكل منشأة', value: figure(row.residentsPerBusiness) },
    { label: 'متوسط الدخل الشهري', value: figure(row.income, ' ريال') },
    { label: 'حصة الفلل من المساكن', value: figure(row.villaShare, '%') },
    { label: 'مبانٍ تحت الإنشاء', value: figure(row.underConstruction) },
    { label: 'وسيط إيجار السكن السنوي للمتر', value: median('rent_year_residential') },
    { label: 'وسيط إيجار السكن الشهري للمتر', value: median('rent_month_residential') },
    { label: 'وسيط سعر بيع السكن للمتر', value: median('sale_residential') },
    { label: 'وسيط إيجار المحل السنوي للمتر', value: median('rent_year_commercial') },
    { label: 'وسيط إيجار المحل للمتر (المدة غير مذكورة)', value: median('rent_unstated_commercial') },
    { label: 'وسيط سعر الأرض للمتر', value: median('sale_land') },
  ]
}

/** The facts as one line for the assistant: «السكان 12,400 | المنشآت 310 | …». */
export const factsLine = (facts: Fact[]) => facts.map((fact) => `${fact.label} ${fact.value}`).join(' | ')

/** A part of an assistant reply: a paragraph, or a list of short points. */
export type ReplyBlock = { kind: 'p'; text: string } | { kind: 'list'; items: string[] }

const POINT = /^\s*(?:[-•*]|\d+[.)])\s+/

/**
 * An assistant reply split into paragraphs and lists of points («- …», «• …», «1. …»), so a long answer reads in
 * parts instead of one block. Nothing is added or dropped: every line of the reply is in exactly one block.
 */
export function replyBlocks(reply: string): ReplyBlock[] {
  const blocks: ReplyBlock[] = []
  for (const chunk of reply.split(/\n\s*\n/)) {
    const lines = chunk.split('\n').map((line) => line.trim()).filter(Boolean)
    let paragraph: string[] = []
    let list: string[] = []
    const flush = () => {
      if (paragraph.length) blocks.push({ kind: 'p', text: paragraph.join('\n') })
      if (list.length) blocks.push({ kind: 'list', items: list })
      paragraph = []
      list = []
    }
    for (const line of lines) {
      if (POINT.test(line)) {
        if (paragraph.length) { blocks.push({ kind: 'p', text: paragraph.join('\n') }); paragraph = [] }
        list.push(line.replace(POINT, ''))
      } else {
        if (list.length) { blocks.push({ kind: 'list', items: list }); list = [] }
        paragraph.push(line)
      }
    }
    flush()
  }
  return blocks
}

/** «**مهم**» in a reply as bold runs: [text, bold?] pairs, the markers removed. */
export function boldRuns(text: string): [string, boolean][] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, index) => [part, index % 2 === 1] as [string, boolean]).filter(([part]) => part.length > 0)
}
