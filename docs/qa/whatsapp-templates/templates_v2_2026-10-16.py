"""12 multi-purpose UTILITY templates (logo header) — owner-approved plan 2026-10-16.
Rules learned from Meta's decision: reference number, an event that happened, closed-value variables (enums set by the system),
two action buttons on the same event, no promotional wording. Seller scenario «periodic price-list update» dropped (owner).
Run: python3 templates_v2_2026-10-16.py <railway-vars.json> <logo.jpg>  — never prints the token."""
import json, sys, urllib.request, urllib.error

# closed values the system may put in the «نوع التحديث» variables (anything else must not be sent)
ENUMS = {
 'farq_rfq_update_seller_ar': ['تعديل الكمية', 'تمديد مهلة التسعير', 'إلغاء الطلب من المشتري', 'تم اختيار عرضكم', 'إغلاق الطلب دون اختيار عرضكم'],
 'farq_po_payment_ar': ['إصدار أمر شراء', 'تسجيل دفعة', 'استحقاق دفعة متأخرة'],
 'farq_delivery_update_ar': ['تذكير بموعد التوريد', 'الشحنة في الطريق', 'تم التسليم بانتظار تأكيد الاستلام', 'طلب تعديل موعد التسليم'],
 'farq_inquiry_ar': ['المواصفات', 'الكمية', 'التوصيل', 'السعر'],
 'farq_account_notice_ar': ['دعوة للانضمام إلى منشأة', 'تحديث بيانات مطلوب', 'قرب انتهاء السجل التجاري', 'قرب انتهاء الباقة', 'تخصصات مقترحة بانتظار التأكيد'],
 'farq_rfq_status_buyer_ar': ['وصلت عروض جديدة', 'ملخص العروض', 'لا توجد عروض كافية', 'قرب إغلاق الطلب'],
 'farq_request_action_ar': ['إنشاء الطلب وإرساله', 'اعتماد العرض وإصدار أمر الشراء', 'إلغاء الطلب', 'أرشفة الطلب', 'استعادة الطلب'],
}

def tpl(name, body, ex, b1, b2):
    return {"name": name, "language": "ar", "category": "UTILITY", "components": [
        {"type": "HEADER", "format": "IMAGE", "example": {"header_handle": ["{HANDLE}"]}},
        {"type": "BODY", "text": body, "example": {"body_text": [ex]}},
        {"type": "FOOTER", "text": "فرق • إشعار مرتبط بالرقم المرجعي"},
        {"type": "BUTTONS", "buttons": [{"type": "QUICK_REPLY", "text": b1}, {"type": "QUICK_REPLY", "text": b2}]}]}

T = [
 # ── البائع ──
 tpl("farq_rfq_new_v2_ar",
  "السلام عليكم،\n*طلب تسعير جديد | #RFQ-{{1}}*\n\nوصلكم هذا الإشعار بناءً على احتياج توريد صادر من: {{2}}\n\n• البند: {{3}}\n• الكمية: {{4}}\n• الموقع: {{5}}\n\n👇 لإرسال سعرك المباشر وتفاصيل التوصيل:",
  ["709", "مؤسسة البناء الحديث للمقاولات", "شريط بيوتيل عازل 10 سم", "200 لفة", "الرياض - حي النرجس"], "تقديم السعر الآن", "اعتذار عن التوريد"),
 tpl("farq_rfq_reminder_v2_ar",
  "السلام عليكم،\n*تذكير موعد | #RFQ-{{1}}*\n\nاستقبال الأسعار لهذا الطلب ينتهي بتاريخ {{2}}.\n\n• البند: {{3}}\n• الموقع: {{4}}\n\n👇 لإرسال سعرك قبل الإغلاق:",
  ["709", "2026-10-20", "شريط بيوتيل عازل 10 سم", "الرياض - حي النرجس"], "تقديم السعر الآن", "اعتذار عن التوريد"),
 tpl("farq_rfq_update_seller_ar",
  "السلام عليكم،\n*تحديث على طلب تسعير | #RFQ-{{1}}*\n\nنوع التحديث: {{2}}\n• البند: {{3}}\n• التفاصيل: {{4}}\n\n👇 لمتابعة الطلب:",
  ["709", "تعديل الكمية", "شريط بيوتيل عازل 10 سم", "الكمية الحالية 300 لفة"], "عرض التفاصيل", "تم الاطلاع"),
 tpl("farq_po_payment_ar",
  "السلام عليكم،\n*أمر شراء ومستحقات | #PO-{{1}}*\n\nنوع التحديث: {{2}}\n• الطلب المرجعي: #RFQ-{{3}}\n• المبلغ: {{4}} ريال\n\n👇 الإجراء المطلوب:",
  ["3301", "إصدار أمر شراء", "709", "4,600"], "تأكيد الاستلام", "طلب توضيح"),
 # ── مشتركة ──
 tpl("farq_delivery_update_ar",
  "السلام عليكم،\n*تحديث التوريد | #PO-{{1}}*\n\nنوع التحديث: {{2}}\n• البند: {{3}}\n• الموعد: {{4}}\n\n👇 الإجراء المطلوب:",
  ["3301", "تذكير بموعد التوريد", "شريط بيوتيل عازل 10 سم", "2026-10-22"], "تأكيد", "طلب تعديل"),
 tpl("farq_inquiry_ar",
  "السلام عليكم،\n*استفسار على طلب | #RFQ-{{1}}*\n\nوصلكم استفسار بخصوص: {{2}}\n• البند: {{3}}\n\n👇 للاطلاع على الاستفسار والرد عليه:",
  ["709", "المواصفات", "شريط بيوتيل عازل 10 سم"], "الرد على الاستفسار", "عرض الطلب"),
 tpl("farq_account_notice_ar",
  "السلام عليكم،\n*إشعار حساب المنشأة | #ACC-{{1}}*\n\nنوع الإشعار: {{2}}\n• المنشأة: {{3}}\n• التاريخ: {{4}}\n\n👇 للاطلاع على التفاصيل:",
  ["5521", "قرب انتهاء السجل التجاري", "مؤسسة البناء الحديث للمقاولات", "2026-11-01"], "عرض التفاصيل", "تحديث البيانات"),
 # ── المشتري ──
 tpl("farq_sup_category_v2_ar",
  "السلام عليكم،\n*تحديث حساب المنشأة | #SUP-{{1}}*\n\nإشعار بتحديث قائمة الموردين والمصانع المعتمدين لنشاطكم المسجل في المنصة.\n\n• التصنيف: {{2}}\n• النطاق الجغرافي: {{3}}\n\n👇 لتفعيل استقبال تحديثات الأسعار وجداول التوريد لهذا التصنيف:",
  ["9041", "مستحضرات عناية وديرما", "الرياض"], "تفعيل التصنيف", "تجاهل"),
 tpl("farq_sup_prices_v2_ar",
  "السلام عليكم،\n*تحديث أسعار التصنيف | #SUP-{{1}}*\n\nصدرت تحديثات على قائمة الأسعار المعتمدة للتصنيف المفعّل في حسابكم.\n\n• التصنيف: {{2}}\n• النطاق الجغرافي: {{3}}\n\n👇 لاستعراض الأسعار المحدثة:",
  ["9041", "مستحضرات عناية وديرما", "الرياض"], "عرض الأسعار", "إيقاف التحديثات"),
 tpl("farq_rfq_status_buyer_ar",
  "السلام عليكم،\n*حالة طلب التسعير | #RFQ-{{1}}*\n\nنوع التحديث: {{2}}\n• عدد العروض المستلمة: {{3}}\n• موعد الإغلاق: {{4}}\n\n👇 الإجراء المطلوب:",
  ["709", "وصلت عروض جديدة", "4", "2026-10-20"], "عرض المقارنة", "تمديد الطلب"),
 tpl("farq_request_action_ar",
  "السلام عليكم،\n*تأكيد إجراء على طلب | #RFQ-{{1}}*\n\nالإجراء: {{2}}\n• بواسطة: {{3}}\n• الوقت: {{4}}\n\n👇 للاطلاع على الطلب:",
  ["709", "إنشاء الطلب وإرساله", "عبدالرحمن (مدير المنشأة)", "2026-10-16 10:30"], "عرض الطلب", "التراجع عن الإجراء"),
 tpl("farq_delivery_received_ar",
  "السلام عليكم،\n*تأكيد الاستلام | #PO-{{1}}*\n\nحلّ موعد التسليم لأمر الشراء المرتبط بطلبكم.\n\n• البند: {{2}}\n• المورد: {{3}}\n\n👇 يرجى تأكيد حالة الاستلام:",
  ["3301", "شريط بيوتيل عازل 10 سم", "مؤسسة الحلول العازلة"], "تم الاستلام", "يوجد ملاحظة"),
]

def upload_logo(tok, v, path):
    data = open(path, 'rb').read()
    app = json.load(urllib.request.urlopen(urllib.request.Request(f'https://graph.facebook.com/{v}/app', headers={'Authorization': 'Bearer ' + tok})))['id']
    sess = json.load(urllib.request.urlopen(urllib.request.Request(
        f'https://graph.facebook.com/{v}/{app}/uploads?file_name=farq_logo.jpg&file_length={len(data)}&file_type=image/jpeg', data=b'',
        headers={'Authorization': 'Bearer ' + tok}, method='POST')))['id']
    h = json.load(urllib.request.urlopen(urllib.request.Request(f'https://graph.facebook.com/{v}/{sess}', data=data,
        headers={'Authorization': 'OAuth ' + tok, 'file_offset': '0'}, method='POST')))['h']
    return h

if __name__ == '__main__':
    d = json.load(open(sys.argv[1]))
    tok = d.get('WHATSAPP_CLOUD_ACCESS_TOKEN') or d['CONSTRUCTION_WHATSAPP_ACCESS_TOKEN']
    waba = d['WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID']; v = d.get('WHATSAPP_GRAPH_API_VERSION') or 'v21.0'
    handle = upload_logo(tok, v, sys.argv[2])
    for t in T:
        body = json.dumps(t, ensure_ascii=False).replace('{HANDLE}', handle).encode()
        req = urllib.request.Request(f'https://graph.facebook.com/{v}/{waba}/message_templates', data=body,
                                     headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'})
        try:
            r = json.load(urllib.request.urlopen(req)); print(t['name'], '->', r.get('status'), r.get('category'))
        except urllib.error.HTTPError as e:
            err = json.load(e).get('error', {}); print(t['name'], '-> ERROR', err.get('error_user_msg') or err.get('message'))
