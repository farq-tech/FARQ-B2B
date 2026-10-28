const $ = (id) => document.getElementById(id)
const get = (keys) => new Promise((done) => chrome.storage.local.get(keys, done))
const set = (items) => new Promise((done) => chrome.storage.local.set(items, done))
const fmt = new Intl.NumberFormat('en-US')
const STATUS = { running: 'يعمل…', done: 'انتهى ✓', blocked: 'أوقفه عقار (تحقق أو حظر). افتح الصفحة، حلّ التحقق، ثم استأنف.', paused: 'متوقف مؤقتاً' }
const urlOf = (segs, page = 1) => `https://sa.aqar.fm/${segs.map(encodeURIComponent).join('/')}${page > 1 ? `/${page}` : ''}`
const activeTab = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]

async function refresh() {
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
  const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), listings, mapListings, findTemplate: all.findTemplate ?? null })], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `aqar-listings-${listings.length + mapListings.length}-${Date.now()}.json`
  link.click()
})
$('clear').addEventListener('click', async () => { if (confirm('مسح كل الإعلانات المجمّعة؟')) { await new Promise((done) => chrome.storage.local.clear(done)); refresh() } })
refresh()
setInterval(refresh, 1000)
