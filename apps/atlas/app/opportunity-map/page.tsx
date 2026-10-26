import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'خريطة الفرص | فرق أطلس',
}

export default function OpportunityMapPage() {
  return (
    <main className="h-dvh w-full overflow-hidden bg-[#0d1117]">
      <iframe
        title="خريطة الفرص | فرق أطلس"
        src="/bolt-ui/index.html"
        className="block h-full w-full border-0"
      />
    </main>
  )
}
