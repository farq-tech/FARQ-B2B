import { farqSession } from './farqSession'

/*
 * Scheduled campaign sends — POST /api/targeting/schedule on the pricing proxy (server.py, being built).
 * Body: { keys, message, template, send_at } with send_at an ISO instant (chosen in Saudi time on the page).
 * 404 = the route is not there yet: the page shows «الجدولة قريباً» and turns only the schedule option off.
 */
export type ScheduleOutcome = { status: 'scheduled'; id?: string } | { status: 'soon' } | { status: 'error'; message: string }

export async function scheduleCampaign(body: { keys: string[]; message: string; template: string; send_at: string }): Promise<ScheduleOutcome> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const token = farqSession.getAccessToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let r: Response
  try {
    r = await fetch('/api/targeting/schedule', { method: 'POST', headers, body: JSON.stringify(body), credentials: 'same-origin' })
  } catch {
    return { status: 'error', message: 'تعذّر الاتصال. ما جدولنا شي، حاول بعد شوي.' }
  }
  if (r.status === 404) return { status: 'soon' }
  let data: { ok?: boolean; id?: string; error?: string; message_ar?: string } = {}
  try { data = await r.json() } catch { /* empty or not JSON */ }
  if (!r.ok || data.ok === false) return { status: 'error', message: data.message_ar || (r.status === 401 ? 'انتهت الجلسة. ادخل من جديد.' : 'ما قدرنا نجدول الحملة. حاول بعد شوي.') }
  return { status: 'scheduled', id: data.id }
}
