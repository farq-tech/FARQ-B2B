export type GoalId = 'find-supplier' | 'find-buyers' | 'explore' | 'expand' | 'network' | 'target' | 'rfq'

export type Role = 'مصنع' | 'مورد' | 'موزع' | 'تاجر تجزئة' | 'مشتري مؤسسي'

export type Channel = 'واتساب' | 'هاتف' | 'بريد إلكتروني'

export type Consent = 'granted' | 'unknown' | 'declined'

export type Point = [number, number]

export interface City {
  id: string
  name: string
  available: boolean
}

export interface District {
  id: string
  name: string
  cityId: string
  polygon: Point[]
  center: Point
}

export interface Street {
  id: string
  name: string
  districtId: string
  cityId: string
  from: Point
  to: Point
}

export interface Business {
  id: string
  name: string
  category: string
  activity: string
  specialty: string
  role: Role
  wholesale: boolean
  cityId: string
  districtId: string
  streetId: string
  channels: Channel[]
  whatsapp: string | null
  consent: Consent
  x: number
  y: number
  rating: number
  duplicateOf?: string
}

export type WholesaleFilter = 'all' | 'wholesale' | 'retail'

export interface Filters {
  districts: string[]
  streets: string[]
  categories: string[]
  wholesale: WholesaleFilter
  roles: Role[]
  specialties: string[]
  channels: Channel[]
}

export interface ScoredBusiness extends Business {
  relevance: number
  reasons: string[]
}

/** A privacy-preserving snapshot of a live directory result selected by the user. */
export interface LiveBusinessSnapshot {
  id: string
  name: string
  category: string
  district: string
  street: string
  latitude: number | null
  longitude: number | null
  wholesale: boolean
  whatsapp: boolean
  reason: string
  fit: 'L' | 'M' | 'N' | null
  brandName?: string
  legalName?: string
  branchCount?: string
  employeeCount?: string
  operatingHours?: string
  paymentMethods?: string
  serviceLanguages?: string
  floor?: string
  buildingUse?: string
  makani?: string
  atlasId?: string
  /** The official description of the place (v7 directory); shown as Farq, never a provider name. */
  description?: string
  /** Delivery-app signals (v7), non-contact: rating out of 5 and its ratings count, delivery fee and minimum order in
   * SAR, and the typical delivery time. Each present only when the directory carries it. */
  deliveryRating?: number
  deliveryRateCount?: number
  deliveryFee?: number
  deliveryMinOrder?: number
  deliveryEta?: string
  /** v13 enrichment: the operating-status vote (status_policy vocabulary) and its confidence/freshness; the canonical
   * weekly hours (JSON in the sun..sat schema); and the WhatsApp state. Each present only when the release carries it. */
  statusVoted?: string
  statusConfidence?: 'low' | 'medium' | 'high'
  lastSeenAt?: string
  isStale?: boolean
  hoursWeek?: string
  whatsappState?: 'verified' | 'source_flag_unverified' | 'not_available'
  /** Listing content the directory already carries, shown as Farq (no provider named). Each present only when the
   * release carries a real value; a missing or placeholder value is left out entirely (never shown as «غير متاح»). */
  website?: string
  instagram?: string
  facebook?: string
  snapchat?: string
  tiktok?: string
  xLink?: string
  linkedin?: string
  menuLink?: string
  orderLink?: string
  reservationLink?: string
  reviewsCount?: number
  fullAddressAr?: string
  fullAddressEn?: string
  nationalAddress?: string
  postalCode?: string
  descriptionEn?: string
  extraPhones?: string[]
}

export type RequestType = 'list' | 'rfq' | 'campaign'

export type RequestStatus = 'draft' | 'needs_decision' | 'ready_manual' | 'awaiting' | 'completed'

export interface LineItem {
  id: string
  name: string
  qty: number
  unit: string
  spec: string
}

export interface RfqDetails {
  lineItems: LineItem[]
  deadline: string
  deliveryCity: string
  notes: string
}

export interface CampaignDetails {
  templateId: string
  variables: Record<string, string>
  /** Directory recipients with a WhatsApp contact channel, eligible for this cloud campaign. */
  included: string[]
  /** Per-directory-recipient result from the WhatsApp Cloud API. */
  delivery?: Record<string, 'sent' | 'failed' | 'unknown'>
}

export interface RequestItem {
  id: string
  /** Farq central request id after this draft is saved to the organization workspace. */
  remoteId?: string
  type: RequestType
  title: string
  status: RequestStatus
  createdAt: string
  updatedAt: string
  cityId: string
  /** The city's Arabic name as the map showed it when the request was made (cityId alone only names the sample cities). */
  cityName?: string
  businessIds: string[]
  /** Captures only decision fields from live search, never contact details. */
  liveBusinesses?: LiveBusinessSnapshot[]
  notes?: string
  query?: string
  goal?: GoalId
  rfq?: RfqDetails
  campaign?: CampaignDetails
  reviewedAt?: string
  /** The map view the request was made from (a `/map?…` address), so the request leads back to it. */
  origin?: string
  /** Inbox message id of the accepted quote. */
  acceptedQuoteId?: string
}

export interface Template {
  id: string
  name: string
  kind: 'تسويقي' | 'خدمي' | 'تعريفي'
  approval: 'معتمد' | 'قيد المراجعة'
  body: string
}

export interface QuoteLine {
  name: string
  unitPrice: number
  qty: number
}

export interface InboxMessage {
  id: string
  source: 'rfq' | 'campaign'
  requestId: string
  businessId: string
  body: string
  receivedAt: string
  unread: boolean
  quote?: { lines: QuoteLine[]; validity: string; deliveryDays: number }
  sentiment?: 'مهتم' | 'استفسار' | 'غير مهتم'
  replyDraft?: string
}
