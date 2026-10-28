// Extension side of inject.js: each listing of a Web.find answer is kept once under m:<id>, and the latest request
// is kept as the template the fast collecting mode replays. Writes run one after another.
let queue = Promise.resolve()
const get = (keys) => new Promise((done) => chrome.storage.local.get(keys, done))
const set = (items) => new Promise((done) => chrome.storage.local.set(items, done))
window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== 'farq-aqar') return
  const { url, request, response, page } = event.data
  queue = queue.then(async () => {
    let listings = []
    try { listings = JSON.parse(response)?.data?.Web?.find?.listings ?? [] } catch { return }
    const now = new Date().toISOString()
    const { mapStats } = await get({ mapStats: { answers: 0, listings: 0 } })
    const known = await get(listings.map((listing) => `m:${listing.id}`))
    const fresh = listings.filter((listing) => !known[`m:${listing.id}`])
    await set({
      ...Object.fromEntries(fresh.map((listing) => [`m:${listing.id}`, { ...listing, collected_at: now }])),
      findTemplate: { url, request, page, at: now },
      mapStats: { answers: mapStats.answers + 1, listings: mapStats.listings + fresh.length },
    })
  })
})
