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

function keep(listings) {
  writes = writes.then(async () => {
    const now = new Date().toISOString()
    const { mapStats } = await get({ mapStats: { answers: 0, listings: 0 } })
    const known = await get(listings.map((listing) => `m:${listing.id}`))
    const fresh = listings.filter((listing) => !known[`m:${listing.id}`])
    await set({
      ...Object.fromEntries(fresh.map((listing) => [`m:${listing.id}`, { ...listing, collected_at: now }])),
      mapStats: { answers: mapStats.answers + 1, listings: mapStats.listings + fresh.length },
    })
    return fresh.length
  })
  return writes
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== 'farq-aqar') return
  const { url, request, headers, response, page } = event.data
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

async function ask(template, bbox, from) {
  const body = JSON.parse(template.request)
  body.variables = { ...body.variables, size: SIZE, from, polygon: polygonOf(bbox) }
  const response = await fetch(template.url, { method: 'POST', credentials: 'include', headers: { ...template.headers, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) {
    const retryAfter = Number(response.headers.get('retry-after')) * 1000 || 0
    throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status, retryAfter })
  }
  const find = (await response.json())?.data?.Web?.find
  if (!find) throw new Error('no find in answer')
  return find
}

let running = false
async function fastRun() {
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
        if (error.status === 429) {
          // too fast: wait as asked (or longer each time), slow down for good, and try the same request again
          const strikes = (fast.strikes || 0) + 1
          const wait = Math.max(error.retryAfter, Math.min(WAIT_429_MS[1], WAIT_429_MS[0] * 2 ** (strikes - 1)))
          await set({ fast: { ...fast, current, strikes, slow: (fast.slow || 1) * SLOWER, status: 'waiting', until: Date.now() + wait, error: 'HTTP 429', beat: Date.now() + wait } })
          await sleep(wait)
          continue
        }
        const status = error.status === 403 ? 'blocked' : 'error'
        await set({ fast: { ...fast, active: false, status, error: String(error.message), queue, current, stats } })
        break
      }
      const listings = find.listings ?? []
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
    const { fast } = await get({ fast: null })
    await set({ fast: { ...fast, active: false, status: 'error', error: String(error?.message || error) } })
  } finally { running = false }
}

chrome.runtime.onMessage.addListener((message) => { if (message?.cmd === 'fast-run') fastRun() })
// a run whose tab was reloaded or closed is picked up again by the next Aqar page that opens
get({ fast: null }).then(({ fast }) => { if (fast?.active && Date.now() - (fast.beat || 0) > HEARTBEAT_MS) fastRun() })
