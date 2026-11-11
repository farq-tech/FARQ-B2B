import { FEATURES, type Listing } from './real-estate'

export type ListingResponse = { available: boolean; total: number; listings: Listing[] }

const isNullableFigure = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value))
const isOptionalFigure = (value: unknown) => value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
const isNullableText = (value: unknown) => value === null || typeof value === 'string'
const isDate = (value: unknown) => value === undefined || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
const isNameList = (value: unknown) => Array.isArray(value) && value.every((name) => typeof name === 'string' && name.trim().length > 0)

function isMarketSignal(value: unknown): boolean {
  if (value == null) return true
  if (typeof value !== 'object' || Array.isArray(value)) return false
  const signal = value as Record<string, unknown>
  return ['cheaper_area', 'rent_under_value', 'rent_over_value'].includes(String(signal.kind))
    && typeof signal.label === 'string' && signal.label.trim().length > 0
    && typeof signal.rent_pct === 'number' && Number.isFinite(signal.rent_pct)
    && typeof signal.deal_pct === 'number' && Number.isFinite(signal.deal_pct)
    && isNameList(signal.neighbours)
    && (signal.deal_neighbours === undefined || isNameList(signal.deal_neighbours))
}

function isListing(value: unknown): value is Listing {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const listing = value as Record<string, unknown>
  const positive = (key: string) => isNullableFigure(listing[key]) && (listing[key] == null || (listing[key] as number) >= 0)
  const counts = (key: string) => isOptionalFigure(listing[key]) && (listing[key] === undefined || Number.isSafeInteger(listing[key]))
  const texts = ['group', 'type', 'city']
  const nullableTexts = ['url', 'district_id', 'district_ar', 'photo', 'address']
  const validFeatures = listing.features === undefined || (typeof listing.features === 'object' && listing.features !== null
    && !Array.isArray(listing.features) && Object.entries(listing.features).every(([key, feature]) =>
      FEATURES.some(([id]) => id === key) && (feature === 0 || feature === 1)))

  return typeof listing.id === 'string' && listing.id.trim().length > 0
    && typeof listing.lon === 'number' && Number.isFinite(listing.lon) && listing.lon >= -180 && listing.lon <= 180
    && typeof listing.lat === 'number' && Number.isFinite(listing.lat) && listing.lat >= -90 && listing.lat <= 90
    && listing.check != null && typeof listing.check === 'boolean'
    && Array.isArray(listing.photos) && listing.photos.every((photo) => typeof photo === 'string')
    && texts.every((key) => typeof listing[key] === 'string' && (listing[key] as string).trim().length > 0)
    && nullableTexts.every((key) => isNullableText(listing[key]))
    && (listing.kind === null || listing.kind === 'rent' || listing.kind === 'sale')
    && (listing.deal === null || ['sale', 'rent_year', 'rent_month', 'rent_unstated'].includes(String(listing.deal)))
    && ['price_sar', 'area_sqm', 'sar_per_sqm'].every(positive)
    && isNullableFigure(listing.vs_district_pct)
    && ['beds', 'livings', 'wc'].every(counts)
    && ['street_width', 'age'].every((key) => isOptionalFigure(listing[key]))
    && (listing.age_source === undefined || listing.age_source === 'aqar' || listing.age_source === 'text')
    && (listing.tenants === undefined || ['families', 'singles', 'both'].includes(String(listing.tenants)))
    && validFeatures
    && isDate(listing.listed_on) && isDate(listing.updated_on)
    && (listing.licensed === undefined || typeof listing.licensed === 'boolean')
    && (listing.has_phone === undefined || typeof listing.has_phone === 'boolean')
    && isMarketSignal(listing.signal)
}

/** Reject a malformed market reply before it can create invalid map pins or colliding React keys. */
export function parseListingResponse(input: unknown): ListingResponse {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid listings response')
  const response = input as { available?: unknown; total?: unknown; listings?: unknown }
  if (typeof response.available !== 'boolean' || !Number.isSafeInteger(response.total) || (response.total as number) < 0
    || !Array.isArray(response.listings) || (response.total as number) < response.listings.length) {
    throw new Error('Invalid listings response')
  }
  if (!response.available && ((response.total as number) !== 0 || response.listings.length !== 0)) {
    throw new Error('Unavailable listings response cannot contain results')
  }
  const ids = new Set<string>()
  const listings = response.listings.map((item): Listing => {
    if (!isListing(item) || ids.has(item.id)) {
      throw new Error('Invalid listing row')
    }
    ids.add(item.id)
    // Keep only the card contract. The boolean tells the UI a number can be requested; the number itself never belongs here.
    const {
      id, url, lon, lat, district_id, district_ar, kind, deal, group, type, price_sar, area_sqm, sar_per_sqm,
      vs_district_pct, check, city, photo, photos, address, beds, livings, wc, street_width, age, age_source,
      tenants, features, listed_on, updated_on, licensed, has_phone, signal,
    } = item
    return {
      id, url, lon, lat, district_id, district_ar, kind, deal, group, type, price_sar, area_sqm, sar_per_sqm,
      vs_district_pct, check, city, photo, photos, address,
      ...(beds === undefined ? {} : { beds }), ...(livings === undefined ? {} : { livings }),
      ...(wc === undefined ? {} : { wc }), ...(street_width === undefined ? {} : { street_width }),
      ...(age === undefined ? {} : { age }), ...(age_source === undefined ? {} : { age_source }),
      ...(tenants === undefined ? {} : { tenants }), ...(features === undefined ? {} : { features }),
      ...(listed_on === undefined ? {} : { listed_on }), ...(updated_on === undefined ? {} : { updated_on }),
      ...(licensed === undefined ? {} : { licensed }), ...(has_phone === undefined ? {} : { has_phone }),
      ...(signal === undefined ? {} : { signal }),
    }
  })
  return { available: response.available, total: response.total as number, listings }
}
