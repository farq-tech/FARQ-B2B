import type { DistrictRow } from './city-data'

/**
 * The four user groups of docs/atlas-product-foundation.md. A lens chooses what the map shades by default and
 * which figures come first; it never hides another group's figures for good.
 */
export type LensId = 'shops' | 'marketers' | 'distributors' | 'analysts'

export type MetricId = 'population' | 'businesses' | 'residentsPerBusiness' | 'whatsapp' | 'income' | 'growth' | 'restaurants' | 'villaShare' | 'shopRent' | 'homeRent' | 'homePrice' | 'warehouseRent'

export const METRICS: Record<MetricId, { label: string; value: (row: DistrictRow) => number | null; unit?: string }> = {
  population: { label: 'السكان', value: (row) => row.population },
  businesses: { label: 'المنشآت', value: (row) => row.businesses },
  residentsPerBusiness: {
    label: 'ساكن لكل منشأة',
    value: (row) => (row.population != null && row.businesses ? Math.round(row.population / row.businesses) : null),
  },
  whatsapp: { label: 'منشآت بواتساب', value: (row) => row.whatsapp },
  restaurants: { label: 'مطاعم على تطبيقات التوصيل', value: (row) => row.restaurants },
  villaShare: { label: 'حصة الفلل من المساكن', value: (row) => row.villaShare, unit: '%' },
  shopRent: { label: 'إيجار متر المحل سنوياً', value: (row) => row.realEstate.rent_commercial?.median ?? null, unit: 'ر.س' },
  homeRent: { label: 'إيجار متر السكن سنوياً', value: (row) => row.realEstate.rent_residential?.median ?? null, unit: 'ر.س' },
  homePrice: { label: 'سعر متر السكن للبيع', value: (row) => row.realEstate.sale_residential?.median ?? null, unit: 'ر.س' },
  warehouseRent: { label: 'إيجار متر المستودع سنوياً', value: (row) => row.realEstate.rent_warehouse?.median ?? null, unit: 'ر.س' },
  income: { label: 'متوسط الدخل', value: (row) => row.income, unit: 'ر.س' },
  growth: {
    label: 'مبانٍ جديدة وتحت الإنشاء',
    value: (row) => (row.underConstruction != null && row.newBuildings != null ? row.underConstruction + row.newBuildings : null),
  },
}

export const LENSES: { id: LensId; label: string; metric: MetricId; metrics: MetricId[] }[] = [
  { id: 'shops', label: 'أصحاب المتاجر', metric: 'residentsPerBusiness', metrics: ['residentsPerBusiness', 'shopRent', 'population', 'income', 'villaShare', 'restaurants', 'growth'] },
  { id: 'marketers', label: 'المسوّقون', metric: 'population', metrics: ['population', 'income', 'villaShare', 'homePrice', 'restaurants', 'whatsapp'] },
  { id: 'distributors', label: 'الموزّعون', metric: 'businesses', metrics: ['businesses', 'warehouseRent', 'restaurants', 'growth', 'population'] },
  { id: 'analysts', label: 'المحلّلون', metric: 'population', metrics: ['population', 'businesses', 'residentsPerBusiness', 'income', 'villaShare', 'shopRent', 'homeRent', 'homePrice', 'restaurants', 'growth', 'whatsapp'] },
]

export const lensById = (id: LensId) => LENSES.find((lens) => lens.id === id) ?? LENSES[0]
