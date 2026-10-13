# إعادة استخدام Serper

المصدر الفعلي: /Users/m4pro/farq-eval/google-search-method/README.md وserper_lookup.py. استخرجت دوال وقوائم التحقق الحالية في legacy_extract.py دون تشغيل الملف الأصلي (لأنه يقرأ السر ويهيئ ملفات عند الاستيراد).

خطة أولية فقط: أول ثلاث جهات بلا واتساب حسب ترتيب البحث، من صفر إلى ستة أرصدة، بحث واحد بالاسم والسعودية ثم بحث خرائط بالإنجليزي عند غياب الهاتف أو الموقع. لا تشغيل قبل موافقة المالك على خطة تحتوي أسماء الجهات والعدد والسقف. السر يبقى ~/.config/farq/serper.env، لا نسخ إلى Git أو المحادثة أو الواجهة.

ملف plan.py يبني خطة بلا اتصال. يلزم حفظ الردود والأرصدة في ~/farq-eval/targeting-contacts-2026-10-12/ ومراجعة النتائج قبل تطبيقها. لا تعديل قاعدة بيانات الإنتاج أو إضافة موردين. لا تستخدم دالة call القديمة كما هي: تكرار الطلب ثلاث مرات دون احتساب كل محاولة قد يتجاوز سقف التكلفة.

لا تعتمد extract وحدها: المطابقة loose، والتقاط هاتف من مقتطف دليل، والأرقام الوهمية، وروابط واتساب غير مرتبطة بالهوية تحتاج تصفية قبل قبولها. لا دليل منتج من مقتطف Google، ولا إثبات أن الهاتف يدعم واتساب بمجرد أنه جوال.

ربط Google Places السابق غير مفعّل؛ لا تضف له مفتاحًا. مسار Serper لم يفعّل بعد، ولم يستهلك رصيدًا في هذا العمل.

Current offline commercial policy supersedes the earlier two-search pilot: one paid
attempt per stable commercial identity, no automatic Maps fallback. Plans are unapproved
with cap zero. Execution requires `approved=true`, an explicitly approved credit cap,
a single target, and an absolute permanent `identity_attempt_ledger` path shared by
batches. Unique SQLite transactional reservations prevent duplicate attempts even after
errors; provider failure never authorizes a retry. Planning and validation read no secrets
and use no credits. A business name match cannot establish product-sale evidence or
WhatsApp availability.
