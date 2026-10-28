// Farq Aqar collector. While a run is active, every Aqar list page it lands on is read and the run moves on by itself:
// a slice (a city, a region, a district) that lists sub-areas is replaced by them, so no single search hits Aqar's
// page limit; a district that still stops short of its count is split by property type; otherwise the slice is paged
// to its end. Each listing is kept once, by its Aqar id, as the card shows it (lines of text, link, photo).
(() => {
  const LISTING = /-(\d{5,})$/
  const PAUSE_MS = [1500, 3500]
  const WAIT_MS = 15000
  const STALE_PAGES = 3          // pages in a row with nothing new: the list is repeating itself
  const SHORT = 0.9              // a slice that ends below 90% of its count was cut off

  const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
  const get = (keys) => new Promise((done) => chrome.storage.local.get(keys, done))
  const set = (items) => new Promise((done) => chrome.storage.local.set(items, done))
  const segmentsOf = (url) => decodeURIComponent(new URL(url, location.href).pathname).split('/').filter(Boolean)
  const isPage = (segment) => /^\d+$/.test(segment)
  const urlOf = (segs, page = 1) => `https://sa.aqar.fm/${segs.map(encodeURIComponent).join('/')}${page > 1 ? `/${page}` : ''}`
  const same = (a, b) => a.length === b.length && a.every((s, i) => s === b[i])

  function photo(card) {
    for (const img of card.querySelectorAll('img')) {
      for (const src of [img.currentSrc, img.src, img.dataset.src, (img.srcset || '').split(' ')[0]]) {
        if (src && !src.startsWith('data:') && !src.includes('/icons/')) return src
      }
    }
    for (const el of card.querySelectorAll('[style*="background"]')) {
      const match = el.style.backgroundImage.match(/url\(["']?([^"')]+)/)
      if (match && !match[1].includes('/icons/')) return match[1]
    }
    return null
  }

  function cards() {
    const found = new Map()
    for (const a of document.querySelectorAll('a[href]')) {
      const segs = segmentsOf(a.href)
      const match = (segs.at(-1) || '').match(LISTING)
      if (!match || segs.length < 3 || found.has(match[1])) continue
      const lines = (a.innerText || '').split('\n').map((line) => line.trim()).filter(Boolean)
      if (lines.length) found.set(match[1], { id: match[1], url: urlOf(segs), path: segs, lines, image: photo(a) })
    }
    return [...found.values()]
  }

  // links one level below this slice that carry a count, e.g. «شمال الرياض (31,722)»
  function subAreas(base) {
    const out = new Map()
    for (const a of document.querySelectorAll('a[href]')) {
      const segs = segmentsOf(a.href)
      const count = (a.innerText || '').match(/\(([\d,٬]+)\)/)
      if (count && segs.length === base.length + 1 && same(segs.slice(0, -1), base) && !isPage(segs.at(-1))) {
        out.set(segs.join('/'), { segs, count: Number(count[1].replace(/[,٬]/g, '')) })
      }
    }
    return [...out.values()]
  }

  // the property-type searches of this city («شقق-للإيجار/الرياض» …), to split a district that is still too large
  function typeSlugs(city) {
    const slugs = new Set()
    for (const a of document.querySelectorAll('a[href]')) {
      const segs = segmentsOf(a.href)
      if (segs.length === 2 && segs[1] === city && /-لل(بيع|إيجار)$/.test(segs[0])) slugs.add(segs[0])
    }
    return [...slugs]
  }

  const hasNext = (base, page) => [...document.querySelectorAll('a[href]')].some((a) => same(segmentsOf(a.href), [...base, String(page + 1)]))
  const blocked = () => /blocked|تم حظرك|captcha/i.test(document.title)

  async function scrollThrough() {
    for (let i = 0; i < 12; i++) { window.scrollBy(0, window.innerHeight); await sleep(200) }
    window.scrollTo(0, 0)
  }

  async function step() {
    const { run } = await get({ run: null })
    if (!run?.active) return
    const here = segmentsOf(location.href)
    const page = isPage(here.at(-1) || '') ? Number(here.at(-1)) : 1
    const base = page > 1 ? here.slice(0, -1) : here
    const slice = run.current
    if (!slice || !same(slice.segs, base) || slice.page !== page) return   // the user is browsing elsewhere
    if (blocked()) { await set({ run: { ...run, active: false, status: 'blocked' } }); return }

    let found = []
    for (const started = Date.now(); Date.now() - started < WAIT_MS && !found.length; await sleep(500)) found = cards()
    await scrollThrough()
    found = cards()

    const keys = found.map((card) => `l:${card.id}`)
    const known = await get(keys)
    const fresh = found.filter((card) => !known[`l:${card.id}`])
    const now = new Date().toISOString()
    await set(Object.fromEntries(fresh.map((card) => [`l:${card.id}`, { ...card, collected_at: now }])))

    const stats = { ...run.stats, pages: run.stats.pages + 1, listings: run.stats.listings + fresh.length }
    let queue = [...run.queue]
    let current = { ...slice, seen: slice.seen + found.length, stale: fresh.length ? 0 : slice.stale + 1 }

    const children = page === 1 ? subAreas(base) : []
    let next = null
    if (children.length) {
      queue = [...children.map((child) => ({ segs: child.segs, count: child.count })), ...queue]
    } else if (found.length && hasNext(base, page) && current.stale < STALE_PAGES) {
      next = { ...current, page: page + 1 }
    } else if (!slice.byType && slice.count && current.seen < slice.count * SHORT && base.length >= 3) {
      // a district cut off before its count: the same district once per property type
      const types = typeSlugs(base[1])
      queue = [...types.map((type) => ({ segs: [type, ...base.slice(1)], byType: true })), ...queue]
    }
    if (!next) {
      stats.slices += 1
      const item = queue.shift()
      next = item ? { segs: item.segs, count: item.count ?? null, byType: !!item.byType, page: 1, seen: 0, stale: 0 } : null
    }
    if (!next) { await set({ run: { ...run, active: false, status: 'done', current: null, queue, stats } }); return }
    await set({ run: { ...run, current: next, queue, stats, status: 'running', at: now } })
    await sleep(PAUSE_MS[0] + Math.random() * (PAUSE_MS[1] - PAUSE_MS[0]))
    const latest = (await get({ run: null })).run
    if (latest?.active) location.href = urlOf(next.segs, next.page)
  }

  step()
})()
