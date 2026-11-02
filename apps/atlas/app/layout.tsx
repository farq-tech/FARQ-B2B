import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Sans_Arabic } from 'next/font/google'
import { AppShell } from '@/components/app-shell'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PALETTE } from '@/lib/palette'
import { AppStoreProvider } from '@/lib/store'
import './globals.css'

const plex = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-arabic',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'فرق أطلس | خريطة الفرص والتوريد',
  description: 'منصة سعودية لاكتشاف الموردين والمشترين، طلبات التسعير، وبيانات السوق واستهداف المنشآت.',
  icons: {
    icon: [
      { url: '/icon-light-32x32.png', media: '(prefers-color-scheme: light)' },
      { url: '/icon-dark-32x32.png', media: '(prefers-color-scheme: dark)' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  // Atlas is a light UI (globals.css sets color-scheme: light), so the browser chrome follows it
  colorScheme: 'light',
  // a meta tag cannot read a CSS variable: the literal comes from the palette, the same value as --background
  themeColor: PALETTE.ground,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ar" dir="rtl" className={plex.variable}>
      <body className="font-sans antialiased">
        <div className="atlas-aurora" aria-hidden><span /><span /><span /><span /></div>
        <div className="atlas-dots" aria-hidden />
        <AppStoreProvider>
          <TooltipProvider delay={300}>
            <AppShell>{children}</AppShell>
          </TooltipProvider>
        </AppStoreProvider>
        <Toaster position="bottom-left" dir="rtl" richColors={false} closeButton />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
