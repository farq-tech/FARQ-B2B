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
  refreshFast()
  const { run } = await get({ run: null })
  const { mapStats } = await get({ mapStats: null })
  $('listings').textContent = `${fmt.format(run?.stats?.listings ?? 0)} إعلان`
  $('map').textContent = mapStats ? `من الخريطة بإحداثياتها: ${fmt.format(mapStats.listings)}` : ''
  $('detail').textContent = run ? `${fmt.format(run.stats.pages)} صفحة · ${fmt.format(run.stats.slices)} منطقة انتهت · ${fmt.format(run.queue.length)} متبقية` : 'افتح صفحة بحث في عقار (مثل عقارات/الرياض) ثم ابدأ.'
  $('status').textContent = run ? `${STATUS[run.status] || ''}${run.current ? ` — ${run.current.segs.slice(1).join(' / ')} صفحة ${run.current.page}` : ''}` : ''
  $('pause').hidden = !run?.active
  $('resume').hidden = !run || run.active || run.status === 'done'
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
$('fast').addEventListener('click', async () => {
  const { fast, findTemplate } = await get({ fast: null, findTemplate: null })
  const tab = await activeTab()
  if (!findTemplate || !tab?.url?.startsWith('https://sa.aqar.fm/')) { refreshFast(); return }
  if (fast?.active) { await set({ fast: { ...fast, active: false, status: 'paused' } }); refreshFast(); return }
  let next = fast
  if (!fast || (!fast.current && !fast.queue.length)) {
    // the area the map showed when its last request went out
    const points = JSON.parse(findTemplate.request).variables?.polygon ?? []
    if (points.length < 3) { $('fastStatus').textContent = 'حرّك الخريطة قليلاً ثم اضغط.'; return }
    const lats = points.map((p) => p.lat), lngs = points.map((p) => p.lng)
    const bbox = [Math.min(...lats), Math.min(...lngs), Math.max(...lats), Math.max(...lngs)]
    next = { queue: [{ bbox, depth: 0 }], current: null, stats: { requests: 0, listings: 0, tiles: 0 } }
  }
  // beat 0: whichever Aqar page loads next may take the run, should this tab not answer
  await set({ fast: { ...next, active: true, status: 'running', error: null, beat: 0 } })
  chrome.tabs.sendMessage(tab.id, { cmd: 'fast-run' }, () => {
    // a tab opened before the extension was (re)loaded has no collector in it: reload it and the run starts there
    if (chrome.runtime.lastError) chrome.tabs.reload(tab.id)
  })
  refreshFast()
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
