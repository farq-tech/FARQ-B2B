export type Direction = 'purchase' | 'marketing' | 'availability' | 'partnership' | 'activity'
export type DiscoveryRow = {
  commercial_identity?: { id: string; display_name: string; permanent_role: null; basis: string }; commercial_relationship?: { role: string; commercial_function?: string; evidence_state: string; current_demand: boolean }; reachability?: { channel_presence: string[]; needs_enrichment: boolean; verification: string };
  activity_assessment?: { primary_activity: string | null; conflicts: { reason: string }[] }; unified_activity?: { primary_activity: string | null; source_count: number; conflicts: { reason: string }[] }; usage_reason?: string; commercial_function?: string;
  level?: 'A' | 'B' | 'C' | 'D'; score?: number | null; match_status?: string; commercial_source_title?: string; id: string; name: string; role: string; subject?: string; city?: string; district?: string
  reason: string; verified: boolean; status: string; source_url?: string; observed_at?: string
  verification_dimension?: string; eligibility?: string; blockers: string[]; purchase_intent?: string; availability?: string
}
export type DiscoveryResult = {
  excluded?: { name?: string; subject_id?: string; reason: string | string[] }[]; excluded_count?: number;
  search_mode?: 'activity'; total?: number; next_offset?: number | null; total_capped?: boolean; policy?: 'STRICT' | 'PRAGMATIC'; levels?: Record<string, number>; main?: DiscoveryRow[]; expansion?: DiscoveryRow[]; direct: DiscoveryRow[]; potential: DiscoveryRow[]; catalogue_evidence?: DiscoveryRow[]
  coverage: string; execution_enabled: false; messages_sent?: number; latency_ms: number
  human_validation: string
}
export const commercialReviewEnabled = import.meta.env.DEV && import.meta.env.VITE_FARQ_COMMERCIAL_INTELLIGENCE === '1'
export async function discoverCommercial(text: string, direction: Direction, city: string, platform: 'pricing' | 'construction', signal?: AbortSignal, offset = 0): Promise<DiscoveryResult> {
  if (!commercialReviewEnabled) throw new Error('هذه التجربة المحلية غير مفعّلة')
  const endpoint = platform === 'construction' ? '/construction/discover' : '/commercial/discover'
  const response = await fetch(`/__commercial${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Local-Review-Actor': 'local-review:owner' },
    body: JSON.stringify({ text, direction, city, limit: 20, offset }), signal,
  })
  if (!response.ok) throw new Error('تعذّر البحث في البيئة المحلية')
  const data = await response.json() as DiscoveryResult
  if (data.execution_enabled !== false || data.messages_sent !== 0) throw new Error('لا يُسمح بالإرسال في تجربة المراجعة')
  return data
}
