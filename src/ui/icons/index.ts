/*
 * Farq icon system — one component per icon (src/ui/icons/<Name>.tsx), 24 grid, 1.75 stroke, currentColor.
 * FARQ_ICONS lists them with Arabic names, usage and group for the dev gallery (/ui#farq-icons).
 */
import { PricingRequestsIcon } from './PricingRequests'
import { NewRequestIcon } from './NewRequest'
import { MarketIcon } from './Market'
import { InboxIcon } from './Inbox'
import { OpportunityMapIcon } from './OpportunityMap'
import { MessageTemplatesIcon } from './MessageTemplates'
import { AccountIcon } from './Account'
import { OrganizationIcon } from './Organization'
import { MembersIcon } from './Members'
import { LogoutIcon } from './Logout'
import { UploadBookletIcon } from './UploadBooklet'
import { UploadCatalogIcon } from './UploadCatalog'
import { WriteProductsIcon } from './WriteProducts'
import { SpecialtiesIcon } from './Specialties'
import { SearchIcon } from './Search'
import { FiltersIcon } from './Filters'
import { CityIcon } from './City'
import { DistrictIcon } from './District'
import { StreetIcon } from './Street'
import { WholesaleIcon } from './Wholesale'
import { ClustersIcon } from './Clusters'
import { DeliveryRangeIcon } from './DeliveryRange'
import { SupplierIcon } from './Supplier'
import { BuyerIcon } from './Buyer'
import { ContractorIcon } from './Contractor'
import { QuoteIcon } from './Quote'
import { ComparisonIcon } from './Comparison'
import { PurchaseOrderIcon } from './PurchaseOrder'
import { PaymentsIcon } from './Payments'
import { DeliveryIcon } from './Delivery'
import { ReceivedIcon } from './Received'
import { AppointmentIcon } from './Appointment'
import { CancelIcon } from './Cancel'
import { HideIcon } from './Hide'
import { ShowIcon } from './Show'
import { ArchiveIcon } from './Archive'
import { RestoreIcon } from './Restore'
import { HistoryIcon } from './History'
import { NotificationsIcon } from './Notifications'
import { SettingsIcon } from './Settings'
import { SuccessIcon } from './Success'
import { WarningIcon } from './Warning'
import { ErrorIcon } from './Error'
import { InfoIcon } from './Info'
import { WhatsAppGenericIcon } from './WhatsAppGeneric'
import { SaudiEntityIcon } from './SaudiEntity'

export { IconBase, RiyalGlyph, RIYAL_PATH, RIYAL_W, RIYAL_H, type FarqIconProps, type IconState, type IconMotion } from './base'
export { RiyalSign } from './RiyalSign'
export {
  PricingRequestsIcon,
  NewRequestIcon,
  MarketIcon,
  InboxIcon,
  OpportunityMapIcon,
  MessageTemplatesIcon,
  AccountIcon,
  OrganizationIcon,
  MembersIcon,
  LogoutIcon,
  UploadBookletIcon,
  UploadCatalogIcon,
  WriteProductsIcon,
  SpecialtiesIcon,
  SearchIcon,
  FiltersIcon,
  CityIcon,
  DistrictIcon,
  StreetIcon,
  WholesaleIcon,
  ClustersIcon,
  DeliveryRangeIcon,
  SupplierIcon,
  BuyerIcon,
  ContractorIcon,
  QuoteIcon,
  ComparisonIcon,
  PurchaseOrderIcon,
  PaymentsIcon,
  DeliveryIcon,
  ReceivedIcon,
  AppointmentIcon,
  CancelIcon,
  HideIcon,
  ShowIcon,
  ArchiveIcon,
  RestoreIcon,
  HistoryIcon,
  NotificationsIcon,
  SettingsIcon,
  SuccessIcon,
  WarningIcon,
  ErrorIcon,
  InfoIcon,
  WhatsAppGenericIcon,
  SaudiEntityIcon,
}

export type FarqIcon = (props: import('./base').FarqIconProps) => import('react').ReactNode

export type FarqIconEntry = { key: string; ar: string; usage: string; group: string; Icon: FarqIcon }

export const FARQ_ICONS: FarqIconEntry[] = [
  { key: 'pricing-requests', ar: 'طلبات التسعير', usage: 'الشريط الجانبي «طلبات التسعير»، تبويب الجوال «الطلبات»، رابط طلب التسعير في «طلب جديد»', group: 'الشريط الجانبي', Icon: PricingRequestsIcon },
  { key: 'new-request', ar: 'طلب جديد', usage: 'الشريط الجانبي وتبويب الجوال «طلب جديد»، أزرار «طلب جديد» في خريطة الفرص', group: 'الشريط الجانبي', Icon: NewRequestIcon },
  { key: 'market', ar: 'السوق', usage: 'عنوان قسم «السوق» في الشريط الجانبي', group: 'الشريط الجانبي', Icon: MarketIcon },
  { key: 'inbox', ar: 'صندوق الوارد', usage: 'الشريط الجانبي «صندوق الوارد»، تبويب الجوال «الوارد»', group: 'الشريط الجانبي', Icon: InboxIcon },
  { key: 'opportunity-map', ar: 'خريطة الفرص', usage: 'الشريط الجانبي وتبويب الجوال «خريطة الفرص»', group: 'الشريط الجانبي', Icon: OpportunityMapIcon },
  { key: 'message-templates', ar: 'قوالب الرسائل', usage: 'الشريط الجانبي «قوالب واتساب»، زر «القوالب» في خريطة الفرص', group: 'الشريط الجانبي', Icon: MessageTemplatesIcon },
  { key: 'account', ar: 'حسابي', usage: 'الشريط الجانبي «حسابي»', group: 'الشريط الجانبي', Icon: AccountIcon },
  { key: 'organization', ar: 'المنشأة', usage: 'إعدادات المنشأة (المعرض؛ لا يوجد عنصر تنقل بعد)', group: 'الشريط الجانبي', Icon: OrganizationIcon },
  { key: 'members', ar: 'الأعضاء', usage: 'أعضاء المنشأة (المعرض؛ لا يوجد عنصر تنقل بعد)', group: 'الشريط الجانبي', Icon: MembersIcon },
  { key: 'logout', ar: 'خروج', usage: '«تسجيل الخروج» في بطاقة الحساب بالشريط الجانبي', group: 'الشريط الجانبي', Icon: LogoutIcon },
  { key: 'upload-booklet', ar: 'رفع كراسة', usage: '«كراسة أو طلب شراء» في «طلب جديد»', group: 'الرفع والبحث والفلاتر', Icon: UploadBookletIcon },
  { key: 'upload-catalog', ar: 'رفع كتالوج', usage: '«أبي أبيع منتجاتي» و«ارفع الكتالوج» في «طلب جديد»', group: 'الرفع والبحث والفلاتر', Icon: UploadCatalogIcon },
  { key: 'write-products', ar: 'كتابة المنتجات', usage: '«اكتب منتجاتك» في «طلب جديد»', group: 'الرفع والبحث والفلاتر', Icon: WriteProductsIcon },
  { key: 'specialties', ar: 'التخصصات', usage: '«تخصصاتك» في «طلب جديد»', group: 'الرفع والبحث والفلاتر', Icon: SpecialtiesIcon },
  { key: 'search', ar: 'بحث', usage: 'خانة البحث و«بحث حر» في خريطة الفرص', group: 'الرفع والبحث والفلاتر', Icon: SearchIcon },
  { key: 'filters', ar: 'فلاتر', usage: 'شريط «تضييق النتائج» في خريطة الفرص', group: 'الرفع والبحث والفلاتر', Icon: FiltersIcon },
  { key: 'city', ar: 'المدينة', usage: 'اختيار المدينة في خريطة الفرص', group: 'الرفع والبحث والفلاتر', Icon: CityIcon },
  { key: 'district', ar: 'الحي', usage: 'فلتر «الحي» وتجمعات الأحياء في خريطة الفرص', group: 'الرفع والبحث والفلاتر', Icon: DistrictIcon },
  { key: 'street', ar: 'الشارع', usage: 'فلتر «الشارع» وتجمعات الشوارع في خريطة الفرص', group: 'الرفع والبحث والفلاتر', Icon: StreetIcon },
  { key: 'wholesale', ar: 'جملة', usage: '«جملة فقط» وشارة «جملة» في النتائج والتجمعات', group: 'الرفع والبحث والفلاتر', Icon: WholesaleIcon },
  { key: 'clusters', ar: 'التجمعات', usage: '«تجمعات هذا النشاط» في خريطة الفرص', group: 'الرفع والبحث والفلاتر', Icon: ClustersIcon },
  { key: 'delivery-range', ar: 'نطاق التوصيل', usage: 'نطاق توصيل المورد (المعرض؛ لاحقًا في ملف المورد)', group: 'الرفع والبحث والفلاتر', Icon: DeliveryRangeIcon },
  { key: 'supplier', ar: 'مورد', usage: 'صفة الطرف: مورد', group: 'الأطراف', Icon: SupplierIcon },
  { key: 'buyer', ar: 'مشتري', usage: 'صفة الطرف: مشتري', group: 'الأطراف', Icon: BuyerIcon },
  { key: 'contractor', ar: 'مقاول', usage: 'صفة الطرف: مقاول', group: 'الأطراف', Icon: ContractorIcon },
  { key: 'quote', ar: 'عرض سعر', usage: 'عروض الأسعار والمقارنة (المعرض)', group: 'المشتريات', Icon: QuoteIcon },
  { key: 'comparison', ar: 'مقارنة', usage: 'شاشة المقارنة (المعرض)', group: 'المشتريات', Icon: ComparisonIcon },
  { key: 'purchase-order', ar: 'أمر شراء', usage: 'الترسية وأمر الشراء (المعرض)', group: 'المشتريات', Icon: PurchaseOrderIcon },
  { key: 'payments', ar: 'دفعات', usage: 'الدفعات (المعرض)', group: 'المشتريات', Icon: PaymentsIcon },
  { key: 'delivery', ar: 'توريد', usage: 'التوريد والتوصيل في العروض (المعرض)', group: 'المشتريات', Icon: DeliveryIcon },
  { key: 'received', ar: 'تم الاستلام', usage: 'حالة «تم الاستلام» (المعرض)', group: 'المشتريات', Icon: ReceivedIcon },
  { key: 'appointment', ar: 'موعد', usage: 'المواعيد والمهل (المعرض)', group: 'المشتريات', Icon: AppointmentIcon },
  { key: 'cancel', ar: 'إلغاء', usage: '«إلغاء الطلب» وشارة «ملغي» في طلباتي، وشارة «لا يمكن الإرسال»', group: 'إدارة الطلبات', Icon: CancelIcon },
  { key: 'hide', ar: 'إخفاء', usage: '«إخفاء» وشارة «مخفي» في طلباتي', group: 'إدارة الطلبات', Icon: HideIcon },
  { key: 'show', ar: 'إظهار', usage: '«إظهار» في طلباتي', group: 'إدارة الطلبات', Icon: ShowIcon },
  { key: 'archive', ar: 'أرشفة', usage: '«أرشفة» وشارة «مؤرشف» في طلباتي', group: 'إدارة الطلبات', Icon: ArchiveIcon },
  { key: 'restore', ar: 'استعادة', usage: '«استرجاع» في طلباتي', group: 'إدارة الطلبات', Icon: RestoreIcon },
  { key: 'history', ar: 'السجل', usage: '«السجل» في طلباتي', group: 'إدارة الطلبات', Icon: HistoryIcon },
  { key: 'notifications', ar: 'إشعارات', usage: 'التنبيهات في الشريط العلوي', group: 'النظام', Icon: NotificationsIcon },
  { key: 'settings', ar: 'إعدادات', usage: 'الإعدادات', group: 'النظام', Icon: SettingsIcon },
  { key: 'success', ar: 'نجاح', usage: 'شارات النجاح، وتقييم «مناسب»', group: 'النظام', Icon: SuccessIcon },
  { key: 'warning', ar: 'تنبيه', usage: 'التنبيهات والأخطاء المضمّنة، وتقييم «محتمل»', group: 'النظام', Icon: WarningIcon },
  { key: 'error', ar: 'خطأ', usage: 'حالات الخطأ، وتقييم «غير مناسب»', group: 'النظام', Icon: ErrorIcon },
  { key: 'info', ar: 'معلومة', usage: 'الملاحظات والتلميحات في خريطة الفرص ومحرر القوالب', group: 'النظام', Icon: InfoIcon },
  { key: 'whatsapp-generic', ar: 'واتساب-عام', usage: 'شارة قناة واتساب، رأس معاينة القالب', group: 'النظام', Icon: WhatsAppGenericIcon },
  { key: 'saudi-entity', ar: 'منشأة سعودية', usage: 'علامة منشأة سعودية مسجلة (المعرض؛ لاحقًا للموردين الموثقين)', group: 'النظام', Icon: SaudiEntityIcon },
]
