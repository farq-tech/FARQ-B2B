// Extension side: keeps what inject.js reports, newest last, capped so the browser's storage never fills. Writes run
// one after another; two answers arriving together would otherwise overwrite each other.
const LIMIT = 150
let queue = Promise.resolve()
window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== 'farq-aqar') return
  const { source, ...record } = event.data
  queue = queue.then(() => new Promise((done) => {
    chrome.storage.local.get({ records: [] }, ({ records }) => {
      records.push(record)
      chrome.storage.local.set({ records: records.slice(-LIMIT) }, done)
    })
  }))
})
