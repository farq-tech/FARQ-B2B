"""8 utility templates (4 supplier, 4 buyer) submitted to Meta on 2026-10-16 at the owner's request.
Run: python3 templates_2026-10-16.py <railway-vars.json>  — reads token/WABA from the file, never prints them."""
import json, sys, urllib.request, urllib.error

def tpl(name, header, header_ex, body, body_ex, b1, b2):
    return {"name": name, "language": "ar", "category": "UTILITY", "components": [
        {"type": "HEADER", "format": "TEXT", "text": header, "example": {"header_text": [header_ex]}},
        {"type": "BODY", "text": body, "example": {"body_text": [body_ex]}},
        {"type": "BUTTONS", "buttons": [{"type": "QUICK_REPLY", "text": b1}, {"type": "QUICK_REPLY", "text": b2}]}]}

T = [
 # ── supplier (seller) ──
 tpl("farq_rfq_notice_ar", "تحديث طلب تسعير | #RFQ-{{1}}", "709",
  "السلام عليكم،\nوصلكم هذا الإشعار بناءً على احتياج توريد صادر من: {{1}}\n\n• البند: {{2}}\n• الكمية: {{3}}\n• الموقع: {{4}}\n• الرمز المرجعي: #RFQ-{{5}}\n\n👇 لإرسال سعرك المباشر وتفاصيل التوصيل:",
  ["مؤسسة البناء الحديث للمقاولات", "شريط بيوتيل عازل 10 سم", "200 لفة", "الرياض - حي النرجس", "709"], "تقديم السعر الآن", "اعتذار عن التوريد"),
 tpl("farq_rfq_deadline_ar", "تذكير موعد | #RFQ-{{1}}", "709",
  "السلام عليكم،\nتذكير بأن استقبال الأسعار للطلب #RFQ-{{1}} ينتهي بتاريخ {{2}}.\n\n• البند: {{3}}\n• الموقع: {{4}}\n\n👇 لإرسال سعرك قبل الإغلاق:",
  ["709", "2026-10-20", "شريط بيوتيل عازل 10 سم", "الرياض - حي النرجس"], "تقديم السعر الآن", "اعتذار عن التوريد"),
 tpl("farq_rfq_amended_ar", "تعديل طلب تسعير | #RFQ-{{1}}", "709",
  "السلام عليكم،\nتم تعديل الطلب #RFQ-{{1}} الذي قدّمتم عليه سعراً.\n\n• التعديل: {{2}}\n• الكمية الحالية: {{3}}\n\n👇 هل تحتاجون تحديث سعركم؟",
  ["709", "زيادة الكمية", "300 لفة"], "تحديث السعر", "السعر كما هو"),
 tpl("farq_rfq_quote_status_ar", "حالة عرض السعر | #RFQ-{{1}}", "709",
  "السلام عليكم،\nتحديث على عرضكم المقدّم للطلب #RFQ-{{1}}.\n\n• الحالة: {{2}}\n• البند: {{3}}\n\n👇 لمتابعة الطلب:",
  ["709", "تم اختيار عرضكم مبدئياً", "شريط بيوتيل عازل 10 سم"], "تأكيد الاستلام", "تواصل مع المشتري"),
 # ── buyer ──
 tpl("farq_sup_category_update_ar", "تحديث حساب المنشأة | #SUP-{{1}}", "9041",
  "السلام عليكم،\nإشعار بتحديث قائمة الموردين والمصانع المعتمدين لنشاطكم المسجل في المنصة.\n\n• التصنيف: {{1}}\n• النطاق الجغرافي: {{2}}\n• الرمز المرجعي: #SUP-{{3}}\n\n👇 لتفعيل استقبال تحديثات الأسعار وجداول التوريد لهذا التصنيف:",
  ["مستحضرات عناية وديرما", "الرياض", "9041"], "تفعيل التصنيف", "تجاهل"),
 tpl("farq_sup_price_update_ar", "تحديث أسعار التصنيف | #SUP-{{1}}", "9041",
  "السلام عليكم،\nصدرت تحديثات على قائمة الأسعار المعتمدة للتصنيف المفعّل في حسابكم.\n\n• التصنيف: {{1}}\n• النطاق الجغرافي: {{2}}\n• الرمز المرجعي: #SUP-{{3}}\n\n👇 لاستعراض الأسعار المحدثة:",
  ["مستحضرات عناية وديرما", "الرياض", "9041"], "عرض الأسعار", "إيقاف التحديثات"),
 tpl("farq_rfq_quotes_received_ar", "عروض أسعار | #RFQ-{{1}}", "709",
  "السلام عليكم،\nوصلت عروض أسعار جديدة لطلبكم #RFQ-{{1}}.\n\n• البند: {{2}}\n• عدد العروض: {{3}}\n\n👇 لاستعراض لوحة المقارنة:",
  ["709", "شريط بيوتيل عازل 10 سم", "4"], "عرض المقارنة", "تمديد الطلب"),
 tpl("farq_rfq_closing_buyer_ar", "إغلاق طلب التسعير | #RFQ-{{1}}", "709",
  "السلام عليكم،\nيقترب موعد إغلاق استقبال العروض لطلبكم #RFQ-{{1}}.\n\n• موعد الإغلاق: {{2}}\n• العروض المستلمة: {{3}}\n\n👇 الإجراء المطلوب:",
  ["709", "2026-10-20", "4"], "اعتماد أفضل عرض", "تمديد المدة"),
]

if __name__ == "__main__":
    d = json.load(open(sys.argv[1]))
    tok = d.get("WHATSAPP_CLOUD_ACCESS_TOKEN") or d["CONSTRUCTION_WHATSAPP_ACCESS_TOKEN"]
    waba = d["WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID"]; v = d.get("WHATSAPP_GRAPH_API_VERSION") or "v21.0"
    for t in T:
        req = urllib.request.Request(f"https://graph.facebook.com/{v}/{waba}/message_templates", data=json.dumps(t).encode(),
                                     headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
        try:
            r = json.load(urllib.request.urlopen(req)); print(t["name"], "->", r.get("status"), r.get("category"))
        except urllib.error.HTTPError as e:
            err = json.load(e).get("error", {}); print(t["name"], "-> ERROR", err.get("error_user_msg") or err.get("message"))
