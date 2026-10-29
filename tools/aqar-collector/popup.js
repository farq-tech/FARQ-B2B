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
  // the same state in the title, for a popup.html opened as a tab and read from outside (an automation script)
  document.title = [exportStatus, $('listings').textContent, $('map').textContent, $('fastStatus').textContent].filter(Boolean).join(' · ')
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

async function launch(tab, next) {
  // beat 0: whichever Aqar page loads next may take the run, should this tab not answer
  await set({ fast: { ...next, active: true, status: 'running', error: null, beat: 0 } })
  chrome.tabs.sendMessage(tab.id, { cmd: 'fast-run' }, () => {
    // a tab opened before the extension was (re)loaded has no collector in it: reload it and the run starts there
    if (chrome.runtime.lastError && /establish connection|Receiving end/.test(chrome.runtime.lastError.message)) chrome.tabs.reload(tab.id)
  })
  refreshFast()
}

$('fast').addEventListener('click', async () => {
  const { fast, findTemplate } = await get({ fast: null, findTemplate: null })
  const tab = await activeTab()
  if (!findTemplate || !tab?.url?.startsWith('https://sa.aqar.fm/')) { refreshFast(); return }
  if (fast?.active) { await set({ fast: { ...fast, active: false, status: 'paused' } }); refreshFast(); return }
  let next = fast
  if (!fast || (!fast.current && !fast.queue.length)) {
    const bbox = shownArea(findTemplate)
    if (!bbox) { $('fastStatus').textContent = 'حرّك الخريطة قليلاً ثم اضغط.'; return }
    next = { queue: [{ bbox, depth: 0 }], current: null, stats: { requests: 0, listings: 0, tiles: 0 } }
  }
  await launch(tab, next)
})
// a new city: the area on screen now replaces what is left of the last run; collected listings stay
$('fastArea').addEventListener('click', async () => {
  const { findTemplate } = await get({ findTemplate: null })
  const tab = await activeTab()
  if (!findTemplate || !tab?.url?.startsWith('https://sa.aqar.fm/')) { refreshFast(); return }
  const bbox = shownArea(findTemplate)
  if (!bbox) { $('fastStatus').textContent = 'حرّك الخريطة قليلاً ثم اضغط.'; return }
  if (!confirm('بدء سحب المنطقة الظاهرة على الخريطة الآن؟ ما جُمع يبقى، وما تبقى من السحب السابق يُترك.')) return
  await launch(tab, { queue: [{ bbox, depth: 0 }], current: null, stats: { requests: 0, listings: 0, tiles: 0 } })
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
// records are read in batches and written as one JSON text each: the whole store at once (150,000+ listings) is
// more memory than a popup gets, and a single JSON string that long is more than JavaScript allows
let exportStatus = ''
async function exportAll() {
  const BATCH = 2000
  const keys = chrome.storage.local.getKeys ? await chrome.storage.local.getKeys() : Object.keys(await get(null))
  const { findTemplate = null, contactSamples = [] } = await get({ findTemplate: null, contactSamples: [] })
  const parts = ['{"exported":', JSON.stringify(new Date().toISOString())]
  let total = 0
  for (const [name, prefix] of [['listings', 'l:'], ['mapListings', 'm:']]) {
    const mine = keys.filter((key) => key.startsWith(prefix))
    parts.push(`,${JSON.stringify(name)}:[`)
    let first = true
    for (let i = 0; i < mine.length; i += BATCH) {
      const chunk = await get(mine.slice(i, i + BATCH))
      for (const key of mine.slice(i, i + BATCH)) {
        if (!(key in chunk)) continue
        parts.push(first ? '' : ',', JSON.stringify(chunk[key]))
        first = false
        total += 1
      }
      exportStatus = `يصدّر ${fmt.format(Math.min(i + BATCH, mine.length))} / ${fmt.format(mine.length)} ${name}`
    }
    parts.push(']')
  }
  parts.push(',"findTemplate":', JSON.stringify(findTemplate), ',"contactSamples":', JSON.stringify(contactSamples), '}')
  const blob = new Blob(parts, { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `aqar-listings-${total}-${Date.now()}.json`
  link.click()
  exportStatus = `صُدّر ${fmt.format(total)}`
}
$('export').addEventListener('click', () => exportAll().catch((error) => { exportStatus = `فشل التصدير: ${error?.message || error}` }))
$('clear').addEventListener('click', async () => { if (confirm('مسح كل الإعلانات المجمّعة؟')) { await new Promise((done) => chrome.storage.local.clear(done)); refresh() } })
refresh()
setInterval(refresh, 1000)
// popup.html opened as a tab with a hash acts without a click (an automation script's way in): #export downloads the
// export; #run=S,W,N,E;S,W,N,E… starts a fast run over those boxes in an open Aqar tab, or opens one
;(async () => {
  const hash = decodeURIComponent(location.hash)
  if (hash === '#export') $('export').click()
  else if (hash === '#stop') {
    const { fast } = await get({ fast: null })
    if (fast?.active) await set({ fast: { ...fast, active: false, status: 'paused' } })
    exportStatus = 'STOPPED'
  }
  else if (hash === '#reload') chrome.runtime.reload()
  else if (hash === '#ping') {
    const tabs = await chrome.tabs.query({ url: 'https://sa.aqar.fm/*' })
    const answers = await Promise.all(tabs.map((t) => new Promise((done) => chrome.tabs.sendMessage(t.id, { cmd: 'ping' }, (r) => done({ id: t.id, active: t.active, discarded: t.discarded, status: t.status, r: r || chrome.runtime.lastError?.message })))))
    exportStatus = 'PING ' + JSON.stringify(answers)
  }
  else if (hash === '#template') {
    const { findTemplate } = await get({ findTemplate: null })
    exportStatus = 'TEMPLATE ' + (findTemplate?.request || '').slice(0, 2500)
  }
  else if (hash === '#state') {
    const { fast, findTemplate } = await get({ fast: null, findTemplate: null })
    const { queue, ...rest } = fast || {}
    exportStatus = 'STATE v' + chrome.runtime.getManifest().version + ' ' + JSON.stringify({ ...rest, queueLength: queue?.length, templateAt: findTemplate?.at, templateUrl: findTemplate?.url, templatePage: findTemplate?.page, templateWide: /listings\{age /.test(findTemplate?.request || '') }).slice(0, 1500)
  }
  else if (hash.startsWith('#peek=')) {
    const id = hash.slice(6)
    const found = await get(`m:${id}`)
    exportStatus = found[`m:${id}`] ? 'PEEK ' + JSON.stringify(found[`m:${id}`]).slice(0, 1200) : 'PEEK none'
  }
  else if (hash.startsWith('#run=')) {
    const { fast, findTemplate } = await get({ fast: null, findTemplate: null })
    if (!findTemplate || fast?.active) return
    const queue = hash.slice(5).split(';').map((box) => box.split(',').map(Number)).filter((box) => box.length === 4 && box.every(Number.isFinite)).map((bbox) => ({ bbox, depth: 0 }))
    if (!queue.length) return
    const tabs = await chrome.tabs.query({ url: 'https://sa.aqar.fm/*' })
    const tab = tabs.sort((a, b) => b.id - a.id)[0]
    const next = { queue, current: null, stats: { requests: 0, listings: 0, tiles: 0 } }
    if (tab) await launch(tab, next)
    else { await set({ fast: { ...next, active: true, status: 'running', error: null, beat: 0 } }); chrome.tabs.create({ url: 'https://sa.aqar.fm/الخريطة', active: false }) }
  }
})()
