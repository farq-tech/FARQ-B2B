import { numberFormat } from './insights-api'

/**
 * The release the «ما الجديد» bar announces. A new id shows the bar once more to everyone who closed the last one;
 * write the note in the user's words, one line, what they can now do.
 */
export const RELEASE = {
  id: 'atlas-2026-11-08-v19-national-districts',
  name: `إصدار ${numberFormat.format(8)} نوفمبر ${numberFormat.format(2026)}`,
  note: 'توسعت حدود الأحياء إلى مدن إضافية. إذا لم تتوفر حدود معتمدة لمدينتك، تبقى بيانات المدينة متاحة ويظهر تحليل الأحياء «غير متاح».',
}
