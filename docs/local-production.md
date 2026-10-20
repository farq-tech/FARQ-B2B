# نسخة الإنتاج محليًا

هذه النسخة تشغّل التطبيق من **Dockerfile نفسه** الذي تبنى منه خدمة الإنتاج: واجهة Vite المجمعة وخادم Python على المنفذ `8080`.

## التشغيل

```sh
cp .env.production.local.example .env.production.local
# ضع قيم خدمات القراءة الخاصة بك في .env.production.local
npm run production:local
```

ثم افتح [http://127.0.0.1:8080](http://127.0.0.1:8080).

للتشغيل في الخلفية:

```sh
npm run production:local -- --detach
```

وللإيقاف:

```sh
docker compose --env-file .env.production.local -f docker-compose.local-production.yml down
```

## مطابقة الإنتاج والأمان

- يعتمد البناء على `Dockerfile` نفسه، بما فيه إصدار Node وPython وخط التجميع والخادم.
- `FARQ_API_ORIGIN` و`TARGETING_ORIGIN` يحددان خدمات القراءة التي تستخدمها النسخة. احتفظ ببيانات الاعتماد في `.env.production.local` فقط؛ الملف مستثنى من Git.
- `VITE_MAPBOX_TOKEN` اختياري، ويجعل الخريطة مماثلة لخريطة الإنتاج عند توفير مفتاح Mapbox العام المستخدم حاليًا.
- الإرسال الفوري والجدولة مقفلان داخل ملف Compose بقيم ثابتة: `TARGETING_SEND=0` و`TARGETING_SCHEDULE_ENABLED=0`. لا يمكن أن ترسل النسخة المحلية إلى أي مستلم.
- ينشئ أمر التشغيل `FARQ_SESSION_SECRET` محليًا عند غيابه، ويحتفظ به في الملف المحلي فقط. كما يستخدم Cookie غير Secure داخل `127.0.0.1` كي يعمل تسجيل الدخول عبر HTTP؛ الإنتاج يبقى على إعداد Secure الافتراضي.
