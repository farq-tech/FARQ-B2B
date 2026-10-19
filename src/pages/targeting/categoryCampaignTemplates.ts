import type { MetaTemplate } from '../../api/targetingClient'

/**
 * Marketing templates are intentionally organised by the directory's main
 * commercial activity.  Every template has exactly two body variables:
 * {{1}} is the business name and {{2}} is the editable campaign context.
 *
 * Meta must approve a template before it can be used. Until then the approved
 * general discovery template keeps a campaign usable without falling back to
 * the old construction-only wording.
 */
export const DEFAULT_DISCOVERY_TEMPLATE = 'farq_discover_ar_20261019'

export const CATEGORY_CAMPAIGN_TEMPLATES: Record<string, { template: string; label: string; context: string }> = {
  food: { template: 'farq_discover_food_ar', label: 'الأغذية والمشروبات', context: 'يناسب احتياجات المطاعم والمقاهي ومنشآت الأغذية والمشروبات.' },
  agri: { template: 'farq_discover_agri_ar', label: 'الزراعة والثروة الحيوانية', context: 'يناسب احتياجات المزارع والمشاتل ومشاريع الثروة الحيوانية.' },
  build: { template: 'farq_discover_build_ar', label: 'مواد البناء والتشطيب', context: 'يناسب احتياجات مواد البناء والتشطيب لمشاريعكم.' },
  contract: { template: 'farq_discover_contract_ar', label: 'المقاولات والخدمات الإنشائية', context: 'يناسب احتياجات المقاولات والتشغيل والصيانة للمشاريع.' },
  ind: { template: 'farq_discover_ind_ar', label: 'الصناعة والمصانع', context: 'يناسب احتياجات المصانع من المواد والتوريد والخدمات الصناعية.' },
  equip: { template: 'farq_discover_equip_ar', label: 'المعدات والآلات', context: 'يناسب احتياجات المعدات والآلات وقطع الغيار والخدمات المرتبطة بها.' },
  elec: { template: 'farq_discover_elec_ar', label: 'التقنية والإلكترونيات', context: 'يناسب احتياجات التقنية والإلكترونيات والاتصالات لمنشأتكم.' },
  auto: { template: 'farq_discover_auto_ar', label: 'السيارات والمركبات', context: 'يناسب احتياجات السيارات وقطع الغيار والصيانة والتشغيل.' },
  home: { template: 'farq_discover_home_ar', label: 'الأثاث والمنزل', context: 'يناسب احتياجات الأثاث والتجهيزات والمواد المنزلية.' },
  fashion: { template: 'farq_discover_fashion_ar', label: 'الأزياء والمجوهرات', context: 'يناسب احتياجات الأزياء والمنسوجات والمجوهرات والتوريد.' },
  beauty: { template: 'farq_discover_beauty_ar', label: 'التجميل والعناية', context: 'يناسب احتياجات الصالونات والعيادات التجميلية ومنتجات العناية.' },
  health: { template: 'farq_discover_health_ar', label: 'الصحة والطب', context: 'يناسب احتياجات المستشفيات والعيادات والصيدليات من الأدوية والمستلزمات الطبية.' },
  edu: { template: 'farq_discover_edu_ar', label: 'التعليم والتدريب', context: 'يناسب احتياجات المدارس والمعاهد ومراكز التدريب والتجهيزات التعليمية.' },
  hosp: { template: 'farq_discover_hosp_ar', label: 'الضيافة والفعاليات', context: 'يناسب احتياجات الفنادق والضيافة والفعاليات والتجهيزات.' },
  log: { template: 'farq_discover_log_ar', label: 'النقل واللوجستيات', context: 'يناسب احتياجات النقل والتخزين والشحن والخدمات اللوجستية.' },
  biz: { template: 'farq_discover_biz_ar', label: 'خدمات الأعمال', context: 'يناسب احتياجات الشركات من الخدمات المهنية والتشغيلية.' },
  re: { template: 'farq_discover_re_ar', label: 'العقار', context: 'يناسب احتياجات التطوير العقاري وإدارة وتشغيل الأصول.' },
  fin: { template: 'farq_discover_fin_ar', label: 'المال والتأمين', context: 'يناسب احتياجات الجهات المالية والتأمينية من الخدمات والتوريد.' },
  retail: { template: 'farq_discover_retail_ar', label: 'التجزئة والجملة', context: 'يناسب احتياجات المتاجر وتجار التجزئة والجملة.' },
  energy: { template: 'farq_discover_energy_ar', label: 'الطاقة والمياه والبيئة', context: 'يناسب احتياجات الطاقة والمياه والخدمات البيئية والتشغيلية.' },
  sports: { template: 'farq_discover_sports_ar', label: 'الرياضة والترفيه', context: 'يناسب احتياجات الأندية والمنشآت الرياضية والترفيهية.' },
  media: { template: 'farq_discover_media_ar', label: 'الإعلام والثقافة', context: 'يناسب احتياجات الإعلام والإنتاج والطباعة والخدمات الإبداعية.' },
  personal: { template: 'farq_discover_personal_ar', label: 'الخدمات الشخصية', context: 'يناسب احتياجات منشآت الخدمات الشخصية والتشغيل اليومي.' },
}

export function categoryCampaignTemplate(mainId: string | null | undefined, templates: MetaTemplate[]) {
  const category = mainId ? CATEGORY_CAMPAIGN_TEMPLATES[mainId] : undefined
  if (!category) return { template: DEFAULT_DISCOVERY_TEMPLATE, context: null, category: null, approved: true }
  const approved = templates.some((item) => item.name === category.template && item.status === 'APPROVED')
  return { template: approved ? category.template : DEFAULT_DISCOVERY_TEMPLATE, context: category.context, category, approved }
}
