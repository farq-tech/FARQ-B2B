import { apiBase } from './apiBase'
import { constructionHeaders } from './constructionAuth'

export type MarketingInteraction = {
  id: string
  outcome: 'INTERESTED' | 'NOT_INTERESTED'
  reply_title: string | null
  occurred_at: string
  recipient_id: string
  send_state: string
  interest_state: string | null
  followup_consent: boolean
  opted_out_at: string | null
  campaign_id: string
  campaign_name: string
}

export async function listMarketingInteractions(campaignId?: string): Promise<MarketingInteraction[]> {
  const query = new URLSearchParams({ limit: '100' })
  if (campaignId) query.set('campaign_id', campaignId)
  const response = await fetch(`${apiBase()}/admin/marketing/interactions?${query}`, {
    headers: constructionHeaders(),
    credentials: 'include',
  })
  const body = await response.json().catch(() => null) as { ok?: boolean; data?: MarketingInteraction[]; error?: string } | null
  if (!response.ok || !body?.ok || !Array.isArray(body.data)) throw new Error(body?.error || 'MARKETING_INTERACTIONS_UNAVAILABLE')
  return body.data
}

async function write<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: constructionHeaders({ 'content-type': 'application/json' }),
    credentials: 'include',
    body: JSON.stringify(body),
  })
  const result = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: string } | null
  if (!response.ok || !result?.ok || !result.data) throw new Error(result?.error || 'MARKETING_CAMPAIGN_UNAVAILABLE')
  return result.data
}

export async function prepareMarketingCampaign(input: { name: string; segment: string; phones: string[]; consentRecordedAt: string; consentSource: string }) {
  const campaign = await write<{ id: string }>('/admin/marketing/campaigns', { name: input.name, segment: input.segment })
  await write(`/admin/marketing/campaigns/${encodeURIComponent(campaign.id)}/recipients/batch`, {
    recipients: input.phones.map((phone) => ({ phone })),
    consent: { recordedAt: input.consentRecordedAt, source: input.consentSource },
  })
  return campaign
}
