// Extension side. Keeps every listing of a Web.find answer once under m:<id>, and the latest request as a template.
// The fast run replays that template itself: the area the map showed is cut into tiles until each holds at most
// TILE_MAX listings, and each tile is read SIZE listings at a time. Its state lives in storage, so a reload resumes.
const SIZE = 50
const TILE_MAX = 1000
const MAX_DEPTH = 12
const PAUSE_MS = [2500, 4000]   // Aqar answers 429 at about one request a second
const WAIT_429_MS = [60000, 600000]   // first wait after a 429, and the longest
const SLOWER = 1.5                     // each 429 stretches the pause by this much, for the rest of the run
const HEARTBEAT_MS = 15000
const get = (keys) => new Promise((done) => chrome.storage.local.get(keys, done))
const set = (items) => new Promise((done) => chrome.storage.local.set(items, done))
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
let writes = Promise.resolve()
const LOG = []
const log = (...a) => { LOG.push(new Date().toISOString().slice(11, 19) + ' ' + a.map((x) => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ')); console.log(...a) }

// a listing already kept gains the fields a later answer carries that it lacks (a run with EXTRA_FIELDS after one
// without); its first collected_at stays
function keep(listings) {
  writes = writes.then(async () => {
    const now = new Date().toISOString()
    const { mapStats } = await get({ mapStats: { answers: 0, listings: 0 } })
    const known = await get(listings.map((listing) => `m:${listing.id}`))
    const fresh = listings.filter((listing) => !known[`m:${listing.id}`])
    const richer = listings.filter((listing) => known[`m:${listing.id}`] && Object.keys(listing).some((key) => !(key in known[`m:${listing.id}`])))
    await set({
      ...Object.fromEntries(fresh.map((listing) => [`m:${listing.id}`, { ...listing, collected_at: now }])),
      ...Object.fromEntries(richer.map((listing) => [`m:${listing.id}`, { ...listing, ...known[`m:${listing.id}`], updated_at: now }])),
      mapStats: { answers: mapStats.answers + 1, listings: mapStats.listings + fresh.length },
    })
    return fresh.length
  })
  return writes
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== 'farq-aqar') return
  const { url, request, headers, response, page } = event.data
  if (event.data.type === 'contact') {
    writes = writes.then(async () => {
      const { contactSamples } = await get({ contactSamples: [] })
      await set({ contactSamples: [...contactSamples, { url, request, headers, response, page, at: new Date().toISOString() }].slice(-40) })
    })
    return
  }
  let listings = []
  try { listings = JSON.parse(response)?.data?.Web?.find?.listings ?? [] } catch { return }
  keep(listings)
  writes = writes.then(() => set({ findTemplate: { url, request, headers, page, at: new Date().toISOString() } }))
})

const polygonOf = ([south, west, north, east]) => [
  { lat: north, lng: east }, { lat: north, lng: west }, { lat: south, lng: west }, { lat: south, lng: east }, { lat: north, lng: east }]
const quarters = ([s, w, n, e]) => {
  const lat = (s + n) / 2, lng = (w + e) / 2
  return [[s, w, lat, lng], [s, lng, lat, e], [lat, w, n, lng], [lat, lng, n, e]]
}

const ANSWER_MS = 60000
let asked = 0

/** One request sent by the page itself (inject.js), so it carries the page's session exactly as Aqar's own do. */
function pageFetch(url, headers, body) {
  const id = `${Date.now()}-${++asked}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { window.removeEventListener('message', listen); reject(Object.assign(new Error('no answer'), { network: true })) }, ANSWER_MS)
    function listen(event) {
      if (event.source !== window || event.data?.source !== 'farq-aqar-answer' || event.data.id !== id) return
      clearTimeout(timer)
      window.removeEventListener('message', listen)
      log('[farq] answer', id, event.data.status, (event.data.text || '').length)
      resolve(event.data)
    }
    window.addEventListener('message', listen)
    log('[farq] ask', id, url)
    window.postMessage({ source: 'farq-aqar-ask', id, url, headers, body }, '*')
  })
}

// listing fields the map's own query leaves out and the server gives when asked (found 2026-10-29 by asking): the
// building's age, its rooms, the plot's width and length, the features, the licence and deed, and the dates
const EXTRA_FIELDS = ['age', 'rooms', 'width', 'length', 'stairs', 'furnished', 'maid', 'driver', 'lift', 'ketchen', 'ac',
  'duplex', 'pool', 'basement', 'backyard', 'car_entrance', 'extra_unit', 'tent', 'playground', 'two_entrances',
  'apartment_in_villa', 'private_roof', 'stores', 'family', 'men_place', 'create_time', 'refresh', 'last_update',
  'rega_licensed', 'ad_license_number', 'deed_area', 'rega_rooms', 'rega_category', 'usages', 'verified', 'user_type',
  'location_street', 'location_district', 'location_building_number']

/** The template's query with EXTRA_FIELDS added to its listing fields (once; the fragment serves both finds). */
function widen(query) {
  const wanted = EXTRA_FIELDS.filter((field) => !new RegExp(`[{ ]${field}[ }]`).test(query))
  return wanted.length ? query.replace('listings{', `listings{${wanted.join(' ')} `) : query
}

async function ask(template, bbox, from) {
  const body = JSON.parse(template.request)
  if (typeof body.query === 'string') body.query = widen(body.query)
  // the whole area, whatever filter the map had on when its request was kept
  const { where, daily_renting_filter, sov_listings, ...variables } = body.variables || {}
  body.variables = { ...variables, size: SIZE, from, polygon: polygonOf(bbox) }
  const answer = await pageFetch(template.url, { ...template.headers, 'content-type': 'application/json' }, JSON.stringify(body))
  if (answer.status === 0) throw Object.assign(new Error(answer.error || 'Failed to fetch'), { network: true })
  if (answer.status < 200 || answer.status >= 300) {
    throw Object.assign(new Error(`HTTP ${answer.status}`), { status: answer.status, retryAfter: Number(answer.retryAfter) * 1000 || 0 })
  }
  let find = null
  try { find = JSON.parse(answer.text)?.data?.Web?.find } catch { find = null }
  if (!find) throw Object.assign(new Error('no find in answer'), { network: true })
  return find
}

let running = false
async function fastRun() {
  log('[farq] fastRun start', location.href)
  if (running) return
  running = true
  try {
    for (;;) {
      const { fast, findTemplate } = await get({ fast: null, findTemplate: null })
      if (!fast?.active || !findTemplate) break
      let { queue, current, stats } = fast
      if (!current) {
        const tile = queue.shift()
        if (!tile) { await set({ fast: { ...fast, active: false, status: 'done', queue, stats } }); break }
        current = { ...tile, from: 0, total: null }
      }
      await set({ fast: { ...fast, current, beat: Date.now() } })
      let find
      try {
        find = await ask(findTemplate, current.bbox, current.from)
      } catch (error) {
        log('[farq] ask failed', error.status, error.message)
        if (error.status === 429 || error.network) {
          // too fast: wait as asked (or longer each time), slow down for good, and try the same request again
          const strikes = (fast.strikes || 0) + 1
          const wait = Math.max(error.retryAfter, Math.min(WAIT_429_MS[1], WAIT_429_MS[0] * 2 ** (strikes - 1)))
          // a dropped connection is waited out the same way, without slowing the run
          const slow = error.status === 429 ? (fast.slow || 1) * SLOWER : fast.slow || 1
          await set({ fast: { ...fast, current, strikes, slow, status: 'waiting', until: Date.now() + wait, error: error.network ? 'انقطع الاتصال' : 'HTTP 429', beat: Date.now() + wait } })
          await sleep(wait)
          continue
        }
        const status = error.status === 403 ? 'blocked' : 'error'
        await set({ fast: { ...fast, active: false, status, error: String(error.message), queue, current, stats } })
        break
      }
      const listings = find.listings ?? []
      log('[farq] got total', find.total, 'listings', listings.length, 'first', listings[0]?.id, 'age' in (listings[0] || {}), 'cat', listings[0]?.category)
      const fresh = await keep(listings)
      stats = { ...stats, requests: stats.requests + 1, listings: stats.listings + fresh }
      if (current.from === 0 && find.total > TILE_MAX && current.depth < MAX_DEPTH) {
        queue = [...quarters(current.bbox).map((bbox) => ({ bbox, depth: current.depth + 1 })), ...queue]
        current = null
      } else {
        const from = current.from + SIZE
        if (!listings.length || from >= find.total) { stats.tiles += 1; current = null }
        else current = { ...current, from, total: find.total }
      }
      // a run that has gone through 20 requests since its last 429 waits less long next time
      const strikes = fast.strikes && stats.requests % 20 === 0 ? fast.strikes - 1 : fast.strikes || 0
      await set({ fast: { ...fast, queue, current, stats, strikes, status: 'running', error: null, beat: Date.now() } })
      await sleep((PAUSE_MS[0] + Math.random() * (PAUSE_MS[1] - PAUSE_MS[0])) * (fast.slow || 1))
    }
  } catch (error) {
    log('[farq] fastRun crashed', String(error))
    const { fast } = await get({ fast: null })
    await set({ fast: { ...fast, active: false, status: 'error', error: String(error?.message || error) } })
  } finally { running = false }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => { log('[farq] message', message); if (message?.cmd === 'fast-run') { fastRun(); reply({ ok: true }) } if (message?.cmd === 'ping') reply({ ok: true, running, href: location.href, log: LOG.slice(-8) }) })
// a run whose tab was reloaded or closed is picked up again by the next Aqar page that opens
get({ fast: null }).then(({ fast }) => { if (fast?.active && Date.now() - (fast.beat || 0) > HEARTBEAT_MS) fastRun() })
// and a run that stalled (its tab reloaded mid-request, or the page slept) is taken up again by any open Aqar page
setInterval(() => { if (running) return; get({ fast: null }).then(({ fast }) => { if (fast?.active && fast.status !== 'waiting' && Date.now() - (fast.beat || 0) > 45000) fastRun() }) }, 20000)

// a chat page the user opens from a listing: its address shows how a conversation is reached
if (/chat|محادث|message/i.test(decodeURIComponent(location.pathname))) {
  writes = writes.then(async () => {
    const { contactSamples } = await get({ contactSamples: [] })
    await set({ contactSamples: [...contactSamples, { url: location.href, page: document.referrer, kind: 'chat-page', at: new Date().toISOString() }].slice(-40) })
  })
}

// on a listing's page the advertiser's number and chat may show as links after «اتصال» or «محادثة» is pressed:
// every call, WhatsApp or chat link that appears is kept with the listing it belongs to
const listingId = (decodeURIComponent(location.pathname).match(/-(\d{5,})$/) || [])[1]
if (listingId) {
  const seen = new Set()
  const look = () => {
    for (const a of document.querySelectorAll('a[href^="tel:"], a[href*="wa.me"], a[href*="whatsapp"], a[href*="chat"], a[href*="محادث"]')) {
      if (seen.has(a.href)) continue
      seen.add(a.href)
      writes = writes.then(async () => {
        const { contactSamples } = await get({ contactSamples: [] })
        await set({ contactSamples: [...contactSamples, { kind: 'page-link', listing: listingId, url: a.href, text: (a.innerText || '').trim().slice(0, 80), page: location.href, at: new Date().toISOString() }].slice(-40) })
      })
    }
  }
  new MutationObserver(look).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] })
  look()
}
