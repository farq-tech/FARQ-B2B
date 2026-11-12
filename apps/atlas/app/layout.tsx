import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { AppShell } from '@/components/app-shell'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PALETTE } from '@/lib/palette'
import { AppStoreProvider } from '@/lib/store'
import './globals.css'

// خط هوية (ITF Huwiya Arabic) — نفس الخط المستخدم في تطبيق iOS. يغطي العربية واللاتينية والأرقام.
const huwiya = localFont({
  src: [
    { path: './fonts/itfHuwiyaArabic-Light.woff2', weight: '300', style: 'normal' },
    { path: './fonts/itfHuwiyaArabic-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/itfHuwiyaArabic-Medium.woff2', weight: '500', style: 'normal' },
    { path: './fonts/itfHuwiyaArabic-Bold.woff2', weight: '700', style: 'normal' },
    { path: './fonts/itfHuwiyaArabic-Black.woff2', weight: '900', style: 'normal' },
  ],
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
    <html lang="ar" dir="rtl" className={huwiya.variable}>
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
