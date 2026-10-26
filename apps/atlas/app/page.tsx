import Link from 'next/link'
import { ArrowLeft, BadgeCheck, ChartNoAxesCombined, CheckCircle2, FileSearch, MapPinned, MessageSquareText, SearchCheck, ShieldCheck } from 'lucide-react'
import { AtlasGoalLinks } from '@/components/landing/atlas-goal-links'

const steps = [
  { icon: SearchCheck, title: 'حدّد ما تريد', text: 'ابدأ بهدف واضح: موردون، عملاء، أو فهم السوق.' },
  { icon: MapPinned, title: 'شاهد الفرص على الخريطة', text: 'انتقل من نطاق المدينة إلى الحي والشارع والجهة المناسبة.' },
  { icon: FileSearch, title: 'راجع ثم نفّذ قرارك', text: 'احفظ القائمة أو جهّز طلب تسعير أو مسودة تواصل للمراجعة.' },
]

const benefits = [
  'ترتيب الجهات حسب نطاقك وهدفك التجاري',
  'رؤية موحّدة للبحث والخريطة والاختيار',
  'مراجعة واضحة قبل أي رسالة أو طلب خارجي',
  'تتبّع الطلبات والمسودات من مكان واحد',
]

export default function AtlasLandingPage() {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-3" aria-label="فرق أطلس، الرئيسية">
            <span className="flex items-center gap-1.5" aria-hidden><img src="/brand/farq-b2b.svg" alt="" className="h-6 w-auto" /><strong className="text-[15px] text-foreground">أطلس</strong></span>
            <span><strong className="sr-only">فرق أطلس</strong><small className="text-xs text-muted-foreground">منصة الفرص التجارية</small></span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/login?next=%2Fopportunity-map" className="hidden rounded-lg px-3 py-2 text-sm font-medium sm:block">دخول</Link>
            <Link href="/opportunity-map" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">ابدأ الآن</Link>
          </div>
        </div>
      </header>

      <section className="atlas-landing-hero relative overflow-hidden border-b">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[1.1fr_.9fr] lg:items-center lg:py-24">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm font-medium"><span className="size-2 rounded-full bg-primary" /> فرص منشأتك في مكان واحد</p>
            <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl">قل لنا وش تبي تحقق.<br />ونساعدك توصل للجهة <span className="text-primary">المناسبة.</span></h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">فرق أطلس يجمع فهم السوق، البحث عن الجهات، والخريطة في مساحة واحدة تساعدك على الوصول لقرار تجاري أسرع وأوضح.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/opportunity-map" className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground">استكشف الفرص <ArrowLeft className="size-4" aria-hidden /></Link>
              <a href="#how" className="rounded-lg border bg-card px-5 py-3 font-semibold">كيف تعمل؟</a>
            </div>
            <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="size-4 text-primary" aria-hidden /> لا يتم إرسال أي طلب أو رسالة قبل مراجعتك.</p>
          </div>
          <div className="rounded-3xl border bg-card p-5 shadow-xl shadow-primary/5">
            <div className="rounded-2xl bg-muted/70 p-5">
              <div className="flex items-center justify-between"><p className="font-bold">من البحث إلى القرار</p><ChartNoAxesCombined className="size-5 text-primary" aria-hidden /></div>
              <ol className="mt-5 space-y-3">
                {['اختر هدفك التجاري', 'استكشف النطاق والجهات المطابقة', 'حدّد القائمة التي تناسبك', 'راجع طلبك أو مسودتك قبل التنفيذ'].map((step, index) => (
                  <li key={step} className="flex items-center gap-3 rounded-xl bg-card p-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{index + 1}</span><span className="font-medium">{step}</span></li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8" aria-labelledby="start-title">
        <div className="mb-8 max-w-2xl"><p className="text-sm font-semibold text-primary">ابدأ بهدفك</p><h2 id="start-title" className="mt-2 text-3xl font-bold">وش تريد أن تنجز اليوم؟</h2><p className="mt-3 leading-7 text-muted-foreground">اختر المسار، وستتجه الخريطة والفلاتر نحو القرار الذي تريده.</p></div>
        <AtlasGoalLinks />
      </section>

      <section id="how" className="border-y bg-card">
        <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8"><div className="max-w-2xl"><p className="text-sm font-semibold text-primary">كيف تعمل</p><h2 className="mt-2 text-3xl font-bold">رحلة واحدة بدل التنقل بين أدوات كثيرة</h2></div><ol className="mt-10 grid gap-4 md:grid-cols-3">{steps.map(({ icon: Icon, title, text }, index) => <li key={title} className="rounded-2xl border bg-background p-6"><span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" aria-hidden /></span><p className="mt-5 text-sm font-semibold text-primary">{String(index + 1).padStart(2, '0')}</p><h3 className="mt-1 text-lg font-bold">{title}</h3><p className="mt-2 leading-7 text-muted-foreground">{text}</p></li>)}</ol></div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[.9fr_1.1fr] lg:items-center">
        <div className="rounded-3xl bg-primary p-8 text-primary-foreground"><MessageSquareText className="size-7" aria-hidden /><h2 className="mt-6 text-3xl font-bold leading-tight">قرارك التجاري يظل بيدك.</h2><p className="mt-4 leading-7 text-primary-foreground/80">تستطيع تجهيز قائمة أو طلب أو مسودة، ثم تراجع المحتوى والجهات المختارة قبل اتخاذ أي إجراء خارجي.</p></div>
        <div><p className="text-sm font-semibold text-primary">مصممة لفرق الشركات</p><h2 className="mt-2 text-3xl font-bold">وضوح أكبر في كل خطوة</h2><ul className="mt-6 space-y-4">{benefits.map((benefit) => <li key={benefit} className="flex gap-3"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden /><span className="leading-7">{benefit}</span></li>)}</ul><Link href="/requests" className="mt-8 inline-flex items-center gap-2 font-semibold text-primary">عرض الطلبات والمسودات <ArrowLeft className="size-4" aria-hidden /></Link></div>
      </section>

      <section className="border-t bg-muted/40"><div className="mx-auto max-w-7xl px-5 py-16 text-center sm:px-8"><h2 className="text-3xl font-bold">ابدأ من هدفك التجاري</h2><p className="mx-auto mt-3 max-w-xl leading-7 text-muted-foreground">استكشف السوق وحدد الجهات المناسبة، ثم راجع قرارك قبل تنفيذه.</p><Link href="/opportunity-map" className="mt-7 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground">فتح خريطة الفرص <ArrowLeft className="size-4" aria-hidden /></Link></div></section>

      <footer className="border-t bg-card"><div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8"><p>© 2026 شركة فرق للتكنولوجيا</p><div className="flex gap-5"><Link href="/opportunity-map">خريطة الفرص</Link><Link href="/requests">الطلبات</Link><Link href="/inbox">الوارد</Link></div></div></footer>
    </main>
  )
}
