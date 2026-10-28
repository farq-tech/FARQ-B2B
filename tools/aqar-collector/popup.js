const $ = (id) => document.getElementById(id)
const get = (keys) => new Promise((done) => chrome.storage.local.get(keys, done))
const set = (items) => new Promise((done) => chrome.storage.local.set(items, done))
const fmt = new Intl.NumberFormat('en-US')
const STATUS = { running: 'يعمل…', done: 'انتهى ✓', blocked: 'أوقفه عقار (تحقق أو حظر). افتح الصفحة، حلّ التحقق، ثم استأنف.', paused: 'متوقف مؤقتاً' }
const urlOf = (segs, page = 1) => `https://sa.aqar.fm/${segs.map(encodeURIComponent).join('/')}${page > 1 ? `/${page}` : ''}`
const activeTab = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]

const FAST = { running: 'السحب السريع يعمل…', waiting: 'ينتظر ثم يكمل وحده.', done: 'السحب السريع انتهى ✓', blocked: 'أوقفه عقار. انتظر قليلاً ثم اضغط السحب السريع للاستئناف.', error: 'توقف بخطأ، اضغط للاستئناف.', paused: 'متوقف' }

async function refreshFast() {
  const { fast, findTemplate } = await get({ fast: null, findTemplate: null })
  $('fast').textContent = fast?.active ? 'إيقاف السحب السريع' : (fast?.current || fast?.queue?.length ? 'استئناف السحب السريع' : 'سحب سريع من الخريطة')
  $('fastStatus').textContent = !findTemplate ? 'افتح «الخريطة» في عقار وصغّرها حتى تظهر المدينة كاملة، ثم اضغط.'
    : fast?.active && fast.status === 'waiting' && fast.until > Date.now() ? `${fast.error === 'انقطع الاتصال' ? 'انقطع الاتصال بعقار' : 'عقار طلب التمهّل'}. يكمل وحده بعد ${fmt.format(Math.ceil((fast.until - Date.now()) / 1000))} ثانية · ${fmt.format(fast.stats.requests)} طلب حتى الآن`
    : fast?.active && Date.now() - (fast.beat || 0) > 30000 && fast.beat ? 'لا يتقدم منذ 30 ثانية. أعد تحميل صفحة عقار ليكمل.'
    : fast?.active && !fast.beat ? 'يبدأ… (إن طال الانتظار أعد تحميل صفحة عقار)'
    : fast ? `${FAST[fast.status] || ''} ${fmt.format(fast.stats.requests)} طلب · ${fmt.format(fast.stats.tiles)} مربع انتهى · ${fmt.format(fast.queue.length)} متبقٍ${fast.error ? ` (${fast.error})` : ''}` : ''
}

async function refresh() {
  await refreshFast()
  const { run } = await get({ run: null })
  const { mapStats } = await get({ mapStats: null })
  $('listings').textContent = `${fmt.format(run?.stats?.listings ?? 0)} إعلان`
  $('map').textContent = mapStats ? `من الخريطة بإحداثياتها: ${fmt.format(mapStats.listings)}` : ''
  $('detail').textContent = run ? `${fmt.format(run.stats.pages)} صفحة · ${fmt.format(run.stats.slices)} منطقة انتهت · ${fmt.format(run.queue.length)} متبقية` : 'افتح صفحة بحث في عقار (مثل عقارات/الرياض) ثم ابدأ.'
  $('status').textContent = run ? `${STATUS[run.status] || ''}${run.current ? ` — ${run.current.segs.slice(1).join(' / ')} صفحة ${run.current.page}` : ''}` : ''
  $('pause').hidden = !run?.active
  $('resume').hidden = !run || run.active || run.status === 'done'
  // the same state in the title, for a popup.html opened as a tab and read from outside (e.g. an automation script)
  document.title = [$('listings').textContent, $('map').textContent, $('fastStatus').textContent].filter(Boolean).join(' · ')
}

$('start').addEventListener('click', async () => {
  const tab = await activeTab()
  if (!tab?.url?.startsWith('https://sa.aqar.fm/')) { $('status').textContent = 'افتح صفحة من sa.aqar.fm أولاً.'; return }
  const segs = decodeURIComponent(new URL(tab.url).pathname).split('/').filter(Boolean)
  if (/^\d+$/.test(segs.at(-1) || '')) segs.pop()
  if (segs.length < 2) { $('status').textContent = 'افتح صفحة مدينة، مثل عقارات/الرياض.'; return }
  const { run: old } = await get({ run: null })
  const run = { active: true, status: 'running', root: segs, queue: [], current: { segs, count: null, byType: false, page: 1, seen: 0, stale: 0 },
    stats: { pages: 0, listings: old?.stats?.listings ?? 0, slices: 0 } }
  await set({ run })
  chrome.tabs.update(tab.id, { url: urlOf(segs) })
  refresh()
})
/** The area the map showed when its last request went out, as one tile to start a run from. */
function shownArea(findTemplate) {
  const points = JSON.parse(findTemplate.request).variables?.polygon ?? []
  if (points.length < 3) return null
  const lats = points.map((p) => p.lat), lngs = points.map((p) => p.lng)
  return [Math.min(...lats), Math.min(...lngs), Math.max(...lats), Math.max(...lngs)]
}
// Saudi Arabia, south-west to north-east; the run cuts it into quarters until a tile holds at most 1,000 listings
const KINGDOM = [16.0, 34.4, 32.2, 55.7]
const overlaps = ([s, w, n, e], [bs, bw, bn, be]) => s < bn && n > bs && w < be && e > bw
// the parts of a tile that lie outside a box: up to four rectangles (south, north, west, east of it)
function subtract(tile, box) {
  if (!overlaps(tile, box)) return [tile]
  const [s, w, n, e] = tile, [bs, bw, bn, be] = box
  const out = []
  if (bs > s) out.push([s, w, bs, e])
  if (bn < n) out.push([bn, w, n, e])
  const ms = Math.max(s, bs), mn = Math.min(n, bn)
  if (bw > w) out.push([ms, w, mn, bw])
  if (be < e) out.push([ms, be, mn, e])
  return out
}

async function launch(next, tab) {
  // beat 0: whichever Aqar page loads next may take the run, should this tab not answer
  await set({ fast: { ...next, active: true, status: 'running', error: null, beat: 0 } })
  if (!tab) {
    const tabs = await chrome.tabs.query({ url: 'https://sa.aqar.fm/*' })
    tab = tabs.find((t) => t.active) || tabs[0]
  }
  if (!tab) chrome.tabs.create({ url: 'https://sa.aqar.fm/الخريطة', active: false })
  else chrome.tabs.sendMessage(tab.id, { cmd: 'fast-run' }, () => {
    // a tab opened before the extension was (re)loaded has no collector in it: reload it and the run starts there
    if (chrome.runtime.lastError) chrome.tabs.reload(tab.id)
  })
  refreshFast()
}
// a new run over these boxes; the area a finished run covered is remembered, so the kingdom run leaves it out
async function startFast(boxes, fast, tab) {
  const { covered = [] } = await get({ covered: [] })
  if (fast?.status === 'done' && fast.root?.length) await set({ covered: [...covered, ...fast.root] })
  await launch({ queue: boxes.map((bbox) => ({ bbox, depth: 0 })), current: null, root: boxes, stats: { requests: 0, listings: 0, tiles: 0 } }, tab)
}
async function kingdomBoxes() {
  const { covered = [], fast } = await get({ covered: [], fast: null })
  const done = fast?.status === 'done' && fast.root?.length ? [...covered, ...fast.root] : covered
  return done.reduce((tiles, box) => tiles.flatMap((tile) => subtract(tile, box)), [KINGDOM])
}

$('fast').addEventListener('click', async () => {
  const { fast, findTemplate } = await get({ fast: null, findTemplate: null })
  const tab = await activeTab()
  if (!findTemplate || !tab?.url?.startsWith('https://sa.aqar.fm/')) { refreshFast(); return }
  if (fast?.active) { await set({ fast: { ...fast, active: false, status: 'paused' } }); refreshFast(); return }
  if (fast && (fast.current || fast.queue.length)) { await launch(fast, tab); return }
  const bbox = shownArea(findTemplate)
  if (!bbox) { $('fastStatus').textContent = 'حرّك الخريطة قليلاً ثم اضغط.'; return }
  await startFast([bbox], fast, tab)
})
// a new city: the area on screen now replaces what is left of the last run; collected listings stay
$('fastArea').addEventListener('click', async () => {
  const { fast, findTemplate } = await get({ fast: null, findTemplate: null })
  const tab = await activeTab()
  if (!findTemplate || !tab?.url?.startsWith('https://sa.aqar.fm/')) { refreshFast(); return }
  const bbox = shownArea(findTemplate)
  if (!bbox) { $('fastStatus').textContent = 'حرّك الخريطة قليلاً ثم اضغط.'; return }
  if (!confirm('بدء سحب المنطقة الظاهرة على الخريطة الآن؟ ما جُمع يبقى، وما تبقى من السحب السابق يُترك.')) return
  await startFast([bbox], fast, tab)
})
$('kingdom').addEventListener('click', async () => {
  const { fast, findTemplate } = await get({ fast: null, findTemplate: null })
  if (!findTemplate) { refreshFast(); return }
  if (fast?.active) { $('fastStatus').textContent = 'أوقف السحب الجاري أولاً.'; return }
  if (!confirm('سحب المملكة كلها قد يستغرق ساعات. نبدأ؟')) return
  await startFast(await kingdomBoxes(), fast)
})
$('pause').addEventListener('click', async () => { const { run } = await get({ run: null }); await set({ run: { ...run, active: false, status: 'paused' } }); refresh() })
$('resume').addEventListener('click', async () => {
  const { run } = await get({ run: null })
  if (!run?.current) return
  await set({ run: { ...run, active: true, status: 'running' } })
  const tab = await activeTab()
  chrome.tabs.update(tab.id, { url: urlOf(run.current.segs, run.current.page) })
  refresh()
})
$('export').addEventListener('click', async () => {
  const all = await get(null)
  const pick = (prefix) => Object.entries(all).filter(([key]) => key.startsWith(prefix)).map(([, value]) => value)
  const listings = pick('l:')
  const mapListings = pick('m:')
  const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), listings, mapListings, findTemplate: all.findTemplate ?? null, contactSamples: all.contactSamples ?? [] })], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `aqar-listings-${listings.length + mapListings.length}-${Date.now()}.json`
  link.click()
})
$('clear').addEventListener('click', async () => { if (confirm('مسح كل الإعلانات المجمّعة؟')) { await new Promise((done) => chrome.storage.local.clear(done)); refresh() } })
refresh()
setInterval(refresh, 1000)
// popup.html opened as a tab with a hash runs without a click: #export downloads the export, #kingdom starts the
// kingdom run, #run=S,W,N,E;S,W,N,E… starts a run over those boxes (an automation script's way in)
;(async () => {
  const hash = decodeURIComponent(location.hash)
  if (hash === '#export') $('export').click()
  else if (hash === '#kingdom' || hash.startsWith('#run=')) {
    const { fast, findTemplate } = await get({ fast: null, findTemplate: null })
    if (!findTemplate || fast?.active) return
    const boxes = hash === '#kingdom' ? await kingdomBoxes() : hash.slice(5).split(';').map((box) => box.split(',').map(Number)).filter((box) => box.length === 4 && box.every(Number.isFinite))
    if (boxes.length) await startFast(boxes, fast)
  }
})()
