# فرق أطلس

واجهة أطلس مستقلة عن تطبيق التسعير العام، حتى تبقى صفحة التسعير وخدماتها مستقرة.

## التشغيل المحلي

```sh
cd apps/atlas
pnpm install
pnpm dev
```

لإظهار خريطة Mapbox الفعلية، عرّف `NEXT_PUBLIC_MAPBOX_TOKEN` محلياً أو في بيئة الاستضافة. لا يوضع المفتاح في Git.

## متغيرات بيئة الإنتاج

تُضبط قيم هذه المتغيرات في مضيف الإنتاج فقط:

- `NEXT_PUBLIC_MAPBOX_TOKEN`
- `TARGETING_ORIGIN`
- `TARGETING_PASSWORD`
- `ATLAS_SESSION_SECRET`
- `FARQ_API_ORIGIN`
- `ATLAS_TARGETING_ALLOWED_EMAILS`
- `ATLAS_PUBLIC_ORIGINS`
- `ATLAS_INBOX_OWNER_EMAILS` (optional; verified emails, comma separated, that may review WhatsApp replies no campaign matched at `/inbox/unlinked`. Empty: nobody)
- `VALHALLA_ORIGIN` (optional; private Valhalla routing service used by distribution and coverage planning)
- `VALHALLA_GATEWAY_TOKEN` (server-only bearer token for the authenticated Railway routing gateway)

## ردود واتساب في الوارد

`GET /api/inbox` يقرأ ردود واتساب على حملات منشأة المستخدم المسجّل (وحسابه الشخصي) من خدمة الاستهداف (`TARGETING_ORIGIN`)، مع حالة القراءة وحالة تسليم كل رسالة. `POST /api/inbox` يحفظ القراءة لتتبع الشخص على كل أجهزته. الحساب يُؤخذ من جلسة الخادم لا من المتصفح، ولا رقم هاتف يصل إلى الواجهة.

`/inbox/unlinked` (و`/api/inbox/unlinked`) لمالك فرق فقط (`ATLAS_INBOX_OWNER_EMAILS`): يربط الرد الذي لم يُطابق حملة بحملة أُرسلت إلى الرقم نفسه بعد تأكيد، أو يستبعده. الرقم يظهر مخفياً.

الاستقبال نفسه في خدمة الاستهداف (`services/targeting-api/README.md`، قسم WhatsApp replies)، ومتغيراته هناك.

## فحص الجاهزية

`GET /api/health` يعيد `200` عندما تكون خدمة بيانات السوق وتسجيل الدخول مهيأتين، و`503` عندما ينقص أي منهما. لا يعيد أسراراً أو بيانات مستخدمين.

## مسار نشر بديل عند تعطل Railway

يمكن استضافة `apps/atlas` كتطبيق Next.js مستقل على Vercel، مع إبقاء `TARGETING_ORIGIN` متجهاً إلى خدمة بيانات السوق الحالية. لا يُنقل الدليل أو بيانات العملاء أو قناة الإرسال إلى المضيف البديل.

1. أنشئ مشروع Vercel من المستودع `farq-tech/FARQ-B2B`، واجعل مجلد الجذر `apps/atlas`.
2. اضبط متغيرات الإنتاج المذكورة أعلاه في Vercel دون وضع قيمها في Git.
3. تحقق من `/api/health` ومن تسجيل الدخول ومن بحث خريطة لا ينشئ مسودة أو يرسل شيئاً.
4. أضف `atlas.farq.sa` إلى المشروع ثم حدّث سجل DNS بعد أن تصبح المعاينة سليمة.

يبقى إرسال واتساب منفصلاً ويدويًا من صفحة المراجعة.
