/*
 * SEO for the public landing page. Applied to document.head at runtime by applySeo(); the same tags must
 * also be written statically into index.html for crawlers that do not run JS (request in docs/qa/requests.md).
 *
 * SITE_URL: the production domain of the landing is not decided yet — canonical/og:url fall back to the
 * current origin at runtime. Replace SITE_URL once the domain is fixed.
 */
export const SITE_URL: string | null = null

export const SEO = {
  lang: 'ar',
  dir: 'rtl',
  title: 'فرق تسعير — من هدفك للجهة المناسبة',
  description:
    'فرق تسعير يتطور حول أهداف المنشآت: التسويق والتسعير والاستفسار والشراكات. جرّب بحث الموردين المتاح الآن.',
  siteName: 'فرق تسعير',
  locale: 'ar_SA',
  type: 'website',
  twitterCard: 'summary',
} as const

type MetaSpec = { attr: 'name' | 'property'; key: string; content: string }

function metaTags(url: string): MetaSpec[] {
  return [
    { attr: 'name', key: 'description', content: SEO.description },
    { attr: 'name', key: 'robots', content: 'index, follow' },
    { attr: 'property', key: 'og:type', content: SEO.type },
    { attr: 'property', key: 'og:site_name', content: SEO.siteName },
    { attr: 'property', key: 'og:locale', content: SEO.locale },
    { attr: 'property', key: 'og:title', content: SEO.title },
    { attr: 'property', key: 'og:description', content: SEO.description },
    { attr: 'property', key: 'og:url', content: url },
    { attr: 'name', key: 'twitter:card', content: SEO.twitterCard },
    { attr: 'name', key: 'twitter:title', content: SEO.title },
    { attr: 'name', key: 'twitter:description', content: SEO.description },
  ]
}

/** Static HTML for index.html (crawlers). `url` = the decided production URL of the landing. */
export function seoHeadHtml(url: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return [
    `<title>${esc(SEO.title)}</title>`,
    ...metaTags(url).map((m) => `<meta ${m.attr}="${m.key}" content="${esc(m.content)}" />`),
    `<link rel="canonical" href="${esc(url)}" />`,
  ].join('\n')
}

/** Applies title, meta, Open Graph, Twitter Card, canonical, lang/dir. Returns a function that restores the previous state. */
export function applySeo(doc: Document = document): () => void {
  const url = SITE_URL ?? `${doc.location?.origin ?? ''}/`
  const html = doc.documentElement
  const prev = { title: doc.title, lang: html.lang, dir: html.dir }
  const added: Element[] = []
  const changed: Array<[Element, string | null]> = []

  html.lang = SEO.lang
  html.dir = SEO.dir
  doc.title = SEO.title

  for (const m of metaTags(url)) {
    let el = doc.head.querySelector(`meta[${m.attr}="${m.key}"]`)
    if (el) changed.push([el, el.getAttribute('content')])
    else {
      el = doc.createElement('meta')
      el.setAttribute(m.attr, m.key)
      doc.head.appendChild(el)
      added.push(el)
    }
    el.setAttribute('content', m.content)
  }
  let canonical = doc.head.querySelector('link[rel="canonical"]')
  if (canonical) changed.push([canonical, canonical.getAttribute('href')])
  else {
    canonical = doc.createElement('link')
    canonical.setAttribute('rel', 'canonical')
    doc.head.appendChild(canonical)
    added.push(canonical)
  }
  canonical.setAttribute('href', url)

  return () => {
    doc.title = prev.title
    html.lang = prev.lang
    html.dir = prev.dir
    added.forEach((el) => el.remove())
    changed.forEach(([el, v]) => (el.tagName === 'LINK' ? el.setAttribute('href', v ?? '') : el.setAttribute('content', v ?? '')))
  }
}
