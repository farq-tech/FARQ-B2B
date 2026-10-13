export type Direction = 'purchase' | 'marketing' | 'availability' | 'partnership'
export type DiscoveryRow = {
  id: string; name: string; role: string; subject?: string; city?: string; district?: string
  reason: string; verified: boolean; status: string; source_url?: string; observed_at?: string
  verification_dimension?: string; eligibility?: string; blockers: string[]; purchase_intent?: string; availability?: string
}
export type DiscoveryResult = {
  direct: DiscoveryRow[]; potential: DiscoveryRow[]; catalogue_evidence?: DiscoveryRow[]
  coverage: string; execution_enabled: false; messages_sent?: number; latency_ms: number
  human_validation: string
}
export const commercialReviewEnabled = import.meta.env.DEV && import.meta.env.VITE_FARQ_COMMERCIAL_INTELLIGENCE === '1'
export async function discoverCommercial(text: string, direction: Direction, city: string, platform: 'pricing' | 'construction', signal?: AbortSignal): Promise<DiscoveryResult> {
  if (!commercialReviewEnabled) throw new Error('هذه التجربة المحلية غير مفعّلة')
  const endpoint = platform === 'construction' ? '/construction/discover' : '/commercial/discover'
  const response = await fetch(`/__commercial${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Local-Review-Actor': 'local-review:owner' },
    body: JSON.stringify({ text, direction, city, limit: 10 }), signal,
  })
  if (!response.ok) throw new Error('تعذّر البحث في البيئة المحلية')
  const data = await response.json() as DiscoveryResult
  if (data.execution_enabled !== false || data.messages_sent !== 0) throw new Error('لا يُسمح بالإرسال في تجربة المراجعة')
  return data
}
