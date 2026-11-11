import { createHmac } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { isTargetingAllowed, sessionForRequest, setSession, verifySession } from '@/lib/atlas-session'
import { canUseAdvisor } from '@/lib/advisor-access'
import { realEstateAdvisorFallback } from '@/lib/real-estate-advisor-fallback'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_FACTS = 8000
const MAX_TURNS = 20
const MAX_TEXT = 2000

type AdvisorMode = 'compare' | 'branch' | 'audience' | 'distribution' | 'analysis' | 'real_estate'

const COMMON_RULES = `You are an advisor inside Farq Atlas, a Saudi map and market-data product. Work only from the figures in FACTS; never name an outside source. A figure shown as «غير متاح» stays unavailable. If FACTS says some rows were omitted, do not infer totals, rankings, or values from the partial rows. If the person asks about something not in FACTS (sales, safety, traffic, schools, construction quality, law), say Atlas has no figure for it and suggest how they can check it. Never estimate or promise revenue.

Write in clear Saudi-friendly Arabic, short lines, no tables. Write every number with English digits (0-9), thousands with commas, and the percent sign as %. Give 1–3 useful actions the person can take inside the current path. Explain the figure behind each suggestion, name its limits, and leave the decision with the user. Never contact anyone or take an external action.`

const SYSTEMS: Record<AdvisorMode, string> = {
  compare: `${COMMON_RULES}

Compare the options in FACTS against the person's profile. If their need is unclear, ask at most two short questions in one message. Then explain:
- one line per point that matters to this person, naming which option is ahead and by how much, from FACTS. Compare a figure only when both options have a valid value for that same measure; if either is «غير متاح», mark that measure unavailable for comparison and do not infer the missing value;
- distinguish «أعلى» from «أفضل»: say which option better fits only when the person's stated priority makes that direction clear;
- what each option gives up;
- which option fits which kind of need.
An asking price is not a deal price; say so once if prices drive the comparison.`,
  branch: `${COMMON_RULES}
Help the person improve a branch-opening idea using the selected business activity and district figures. If the exact business concept, customer, or budget matters and is unknown, ask at most two short questions. Suggest how to validate fit, which available district figure supports the suggestion, and what important business fact Atlas cannot establish. Never claim that a low competitor count guarantees demand.`,
  audience: `${COMMON_RULES}
Help the person sharpen an audience-targeting plan using only the selected segment, income threshold, and district figures. Do not confuse residents with business establishments, or district average worker income with each person's income. Suggest which measured districts to test first and what message or offer hypothesis the person could validate.`,
  distribution: `${COMMON_RULES}
Help the person improve the assignment of representatives using only the activity, representative count, district membership, and workload figures in FACTS. Explain any coverage limitation. Suggest a practical adjustment to workload or route planning; do not claim that map distance is drive time or that a route is optimized unless FACTS says so.`,
  analysis: `${COMMON_RULES}
Help the person interpret the selected metric or district comparison in FACTS. Distinguish correlation, ranking, and measured totals. If useful, suggest one additional available metric to compare and one missing figure that could change the interpretation. Do not turn an association into a causal claim.`,
  real_estate: `${COMMON_RULES}
This is general help comparing property listings and search filters, not a legal, lending, valuation, or investment guarantee. Do not refuse a safe request merely because it concerns choosing, renting, or buying property. Help the person judge offers against their stated needs using only listing and district figures in FACTS. If no loaded offers match, say that clearly and suggest relaxing one nonessential filter at a time; do not invent offers or imply the loaded sample is the whole market. If household, purpose, or budget details are missing, ask at most two short questions. Distinguish asking price from a completed sale, and never infer legal status, construction quality, or ongoing availability unless stated in FACTS. End with one or two checks the person should make on the listing or in person.`,
}

type Turn = { role: 'user' | 'assistant'; content: string }

function readInput(value: unknown): { mode: AdvisorMode; facts: string; profile: string; turns: Turn[] } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const mode = input.mode ?? 'compare'
  if (typeof mode !== 'string' || !Object.prototype.hasOwnProperty.call(SYSTEMS, mode)) return null
  if (typeof input.facts !== 'string' || !input.facts.trim() || input.facts.length > MAX_FACTS) return null
  const profile = typeof input.profile === 'string' ? input.profile.slice(0, MAX_TEXT) : ''
  if (!Array.isArray(input.turns) || input.turns.length > MAX_TURNS) return null
  const turns: Turn[] = []
  for (const turn of input.turns) {
    const item = turn as Record<string, unknown>
    if (!item || (item.role !== 'user' && item.role !== 'assistant') || typeof item.content !== 'string' || !item.content.trim()) return null
    turns.push({ role: item.role, content: item.content.slice(0, MAX_TEXT) })
  }
  // the conversation alternates and the person speaks last
  if (turns.some((turn, index) => turn.role !== (index % 2 === 0 ? 'assistant' : 'user')) || (turns.length && turns[turns.length - 1].role !== 'user')) return null
  return { mode: mode as AdvisorMode, facts: input.facts, profile, turns }
}

// The model call runs in the targeting service, which holds the Anthropic key (services/targeting-api/advisor_proxy.py).
function targetingHeaders() {
  const serviceToken = process.env.TARGETING_SERVICE_TOKEN
  if (serviceToken) return { 'content-type': 'application/json', 'x-farq-service': serviceToken }
  const password = process.env.TARGETING_PASSWORD
  if (!password) return null
  return { 'content-type': 'application/json', 'x-farq-service': createHmac('sha256', password).update('farq-proxy-v1').digest('hex') }
}

const UPSTREAM_ERRORS: Record<string, [string, number]> = {
  UNCONFIGURED: ['المستشار غير متاح الآن.', 503],
  REFUSED: ['تعذر إعداد اقتراح لهذا الطلب.', 422],
  BUSY: ['الخدمة مشغولة، حاول بعد قليل.', 429],
}

export async function POST(request: NextRequest) {
  const { session, refreshed } = await sessionForRequest(request)
  if (!session) return NextResponse.json({ error: 'سجّل الدخول لاستخدام المستشار.' }, { status: 401, headers: { 'cache-control': 'no-store' } })
  const origin = process.env.TARGETING_ORIGIN?.replace(/\/$/, '')
  const headers = targetingHeaders()

  let input: ReturnType<typeof readInput> = null
  try { input = readInput(await request.json()) } catch { input = null }
  if (!input) return NextResponse.json({ error: 'طلب المستشار غير صالح.' }, { status: 400, headers: { 'cache-control': 'no-store' } })
  if (!(await verifySession(session)) || !canUseAdvisor(input.mode, isTargetingAllowed(session))) {
    return NextResponse.json({ error: 'حسابك غير مخول لاستخدام المستشار.' }, { status: 403, headers: { 'cache-control': 'no-store' } })
  }

  // the first message carries the figures and the profile; later turns are the conversation itself
  const opening = input.mode === 'compare'
    ? `FACTS\n${input.facts}\n\nPROFILE\n${input.profile || 'لم يحدد بعد.'}\n\nقارن لي بين الخيارين بحسب احتياجي.`
    : `FACTS\n${input.facts}\n\nPROFILE\n${input.profile || 'لم يحدد بعد.'}\n\nساعدني أحسّن قراري في هذا المسار.`
  const messages: Turn[] = [{ role: 'user', content: opening }, ...input.turns]
  const fallback = () => {
    const result = NextResponse.json({ reply: realEstateAdvisorFallback(input.facts, input.profile) }, { headers: { 'cache-control': 'no-store' } })
    if (refreshed) setSession(result, session)
    return result
  }
  if (!origin || !headers) {
    if (input.mode === 'real_estate') return fallback()
    return NextResponse.json({ error: 'المستشار غير متاح الآن.' }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }

  try {
    const response = await fetch(`${origin}/advisor`, { method: 'POST', headers, body: JSON.stringify({ system: SYSTEMS[input.mode], messages }), cache: 'no-store', signal: AbortSignal.timeout(22000) })
    const answer = (await response.json().catch(() => ({}))) as { reply?: string; error?: string }
    if (!response.ok || !answer.reply) {
      if (input.mode === 'real_estate') return fallback()
      const [error, status] = UPSTREAM_ERRORS[answer.error ?? ''] ?? ['تعذر الاتصال بالخدمة.', 502]
      return NextResponse.json({ error }, { status, headers: { 'cache-control': 'no-store' } })
    }
    const result = NextResponse.json({ reply: answer.reply }, { headers: { 'cache-control': 'no-store' } })
    if (refreshed) setSession(result, session)
    return result
  } catch {
    if (input.mode === 'real_estate') return fallback()
    return NextResponse.json({ error: 'تعذر الاتصال بالخدمة.' }, { status: 502 })
  }
}
