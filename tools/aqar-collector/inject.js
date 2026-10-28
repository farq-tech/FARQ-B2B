// Runs in the page itself: copies every JSON answer the Aqar page receives (fetch and XHR) and the page's embedded
// state, and hands them to relay.js unchanged (contact details are hidden later, when Farq processes the export).
(() => {
  const MAX = 400_000

  const send = (kind, url, body) => {
    try {
      const data = typeof body === 'string' ? JSON.parse(body) : body
      let text = JSON.stringify(data)
      if (text.length > MAX) text = text.slice(0, MAX)
      window.postMessage({ source: 'farq-aqar', kind, url: String(url), page: location.href, at: Date.now(), body: text }, '*')
    } catch { /* not JSON */ }
  }

  const realFetch = window.fetch
  window.fetch = async function (...args) {
    const response = await realFetch.apply(this, args)
    try {
      const type = response.headers.get('content-type') || ''
      if (type.includes('json')) response.clone().text().then((text) => send('fetch', response.url, text)).catch(() => {})
    } catch { /* ignore */ }
    return response
  }

  const open = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.addEventListener('load', () => {
      const type = this.getResponseHeader('content-type') || ''
      if (type.includes('json') && typeof this.responseText === 'string') send('xhr', this.responseURL || url, this.responseText)
    })
    return open.call(this, method, url, ...rest)
  }

  // the state a server-rendered page ships with, and the links its listing cards point to
  const snapshot = () => {
    const state = document.getElementById('__NEXT_DATA__')
    if (state?.textContent) send('page-state', location.href, state.textContent)
    const links = [...document.querySelectorAll('a[href]')].map((a) => ({
      href: a.href,
      text: (a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      image: a.querySelector('img')?.src || null,
    })).filter((link) => link.href.includes('aqar.fm'))
    send('page-links', location.href, links)
  }
  window.addEventListener('load', () => setTimeout(snapshot, 1500))
})()
