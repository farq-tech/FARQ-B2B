import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { isTargetingAllowed, sessionForRequest, setSession, verifySession } from '@/lib/atlas-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_FACTS = 8000
const MAX_TURNS = 20
const MAX_TEXT = 2000

// The advisor compares two listings or two districts for one person's need, from Atlas figures only
// (docs/atlas-product-foundation.md: every number from our inventory or «غير متاح», no final recommendation).
const SYSTEM = `You are the comparison assistant inside Farq Atlas, a Saudi map of districts and current property listings. You help one person compare two listings or two districts against their own situation.

Work only from the figures in the FACTS block of the first message. They are Farq's figures; never name an outside source. When something the person asks about is not in FACTS (schools, traffic, safety, building age, finishing quality, noise), say plainly that Atlas has no figure for it and suggest checking it on the ad or by visiting; never estimate it. A figure shown as «غير متاح» stays unavailable.

If the person's need is still unclear after their profile (who will live or work there, what matters most, budget), ask at most two short questions in one message before comparing. Once you know enough, compare:
- one line per point that matters to this person, naming which option is ahead and by how much, from FACTS;
- what each option gives up;
- which option fits which kind of need.
Do not make the final decision for them; end by naming the one or two things they should check on the ad or in person before deciding.

Write in clear Saudi-friendly Arabic, short lines, no tables. Write every number with English digits (0-9), thousands with commas, and the percent sign as %. An asking price is not a deal price; say so once if prices drive the comparison.`

type Turn = { role: 'user' | 'assistant'; content: string }

function readInput(value: unknown): { facts: string; profile: string; turns: Turn[] } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
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
  return { facts: input.facts, profile, turns }
}

export async function POST(request: NextRequest) {
  const { session, refreshed } = await sessionForRequest(request)
  if (!session) return NextResponse.json({ error: 'سجّل الدخول لاستخدام المساعد.' }, { status: 401, headers: { 'cache-control': 'no-store' } })
  if (!isTargetingAllowed(session) || !(await verifySession(session))) return NextResponse.json({ error: 'حسابك غير مخول لاستخدام المساعد.' }, { status: 403, headers: { 'cache-control': 'no-store' } })
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'المساعد غير مفعّل بعد.' }, { status: 503, headers: { 'cache-control': 'no-store' } })

  let input: ReturnType<typeof readInput> = null
  try { input = readInput(await request.json()) } catch { input = null }
  if (!input) return NextResponse.json({ error: 'طلب المقارنة غير صالح.' }, { status: 400 })

  // the first message carries the figures and the profile; later turns are the conversation itself
  const opening = `FACTS\n${input.facts}\n\nPROFILE\n${input.profile || 'لم يحدد بعد.'}\n\nقارن لي بين الخيارين بحسب احتياجي.`
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: opening }, ...input.turns]

  try {
    const client = new Anthropic()
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages,
    })
    if (response.stop_reason === 'refusal') return NextResponse.json({ error: 'تعذر على المساعد الرد على هذا الطلب.' }, { status: 422 })
    const reply = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n').trim()
    if (!reply) return NextResponse.json({ error: 'تعذر الحصول على رد.' }, { status: 502 })
    const result = NextResponse.json({ reply }, { headers: { 'cache-control': 'no-store' } })
    if (refreshed) setSession(result, session)
    return result
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return NextResponse.json({ error: 'المساعد مشغول، حاول بعد قليل.' }, { status: 429 })
    if (error instanceof Anthropic.APIError) return NextResponse.json({ error: 'تعذر الاتصال بالمساعد.' }, { status: 502 })
    return NextResponse.json({ error: 'تعذر الاتصال بالمساعد.' }, { status: 502 })
  }
}
