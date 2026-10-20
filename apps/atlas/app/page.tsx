import Link from 'next/link'
import { ArrowLeft, MapPinned, MessageSquareText, SearchCheck } from 'lucide-react'

const highlights = [
  { icon: MapPinned, title: 'شاهد السوق على الخريطة', text: 'استكشف الأحياء والتجمعات والمنشآت قبل أن تبدأ التواصل.' },
  { icon: SearchCheck, title: 'اختر الجهات المناسبة', text: 'ابحث، صفِّ، وحدد الجهات ثم راجعها في قائمة واحدة.' },
  { icon: MessageSquareText, title: 'راجع قبل أي إجراء', text: 'أنشئ طلب تسعير أو مسودة حملة، ولا يتم إرسال شيء تلقائياً.' },
]

export default function AtlasLandingPage() {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground" aria-hidden>أ</span>
          <div className="leading-tight">
            <p className="font-bold">فرق أطلس</p>
            <p className="text-xs text-muted-foreground">منصة الفرص التجارية</p>
          </div>
        </div>
        <Link href="/opportunity-map" className="rounded-lg border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-muted">
          دخول المنصة
        </Link>
      </header>

      <section className="mx-auto grid max-w-6xl gap-10 px-5 pb-20 pt-16 sm:px-8 lg:grid-cols-[1.15fr_.85fr] lg:items-center lg:pt-24">
        <div>
          <p className="mb-5 inline-flex rounded-full bg-accent px-3 py-1 text-sm font-medium text-accent-foreground">فرق أطلس</p>
          <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl">اعرف أين توجد فرصك التجارية قبل أن تبدأ.</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">أطلس يجمع البحث والخريطة والاختيار والمراجعة في رحلة واحدة تساعد فريقك على اتخاذ قرار تجاري أوضح.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/opportunity-map" className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90">
              ابدأ من خريطة الفرص <ArrowLeft className="size-4" aria-hidden />
            </Link>
            <Link href="/requests" className="rounded-lg border bg-card px-5 py-3 font-semibold transition-colors hover:bg-muted">راجع طلباتك</Link>
          </div>
          <p className="mt-5 text-sm text-muted-foreground">كل إجراء تجاري يمر بالمراجعة. لا يوجد إرسال تلقائي.</p>
        </div>

        <div className="rounded-3xl border bg-card p-5 shadow-sm">
          <div className="rounded-2xl bg-[linear-gradient(135deg,#e2f1ec_0%,#f6f7f5_48%,#dbece7_100%)] p-6">
            <p className="text-sm font-medium text-primary">رحلة أطلس</p>
            <ol className="mt-5 space-y-4">
              {['حدد هدفك التجاري', 'استكشف السوق وحدد الجهات', 'راجع القائمة وأنشئ طلبك أو مسودتك'].map((step, index) => (
                <li key={step} className="flex items-center gap-3 rounded-xl bg-card/90 p-3 shadow-sm">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{index + 1}</span>
                  <span className="font-medium">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="border-t bg-card">
        <div className="mx-auto grid max-w-6xl gap-4 px-5 py-12 sm:grid-cols-3 sm:px-8">
          {highlights.map(({ icon: Icon, title, text }) => (
            <article key={title} className="rounded-2xl border bg-background p-5">
              <Icon className="size-5 text-primary" aria-hidden />
              <h2 className="mt-4 font-bold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
