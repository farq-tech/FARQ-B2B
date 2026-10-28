// Runs in the page itself: copies every JSON answer the Aqar page receives (fetch and XHR) and the page's embedded
// state, and hands them to relay.js. Contact details are blanked here, before anything is stored.
(() => {
  const CONTACT_KEY = /phone|mobile|whats|tel|contact|email|owner_name|user_name/i
  // whoever placed the ad: their whole record is dropped, Atlas links to the listing instead
  const PERSON_KEY = /^(user|owner|advertiser|agent|publisher)$/i
  const PHONE = /^(\+?966|00966|0)?5\d{8}$/
  const MAX = 400_000

  const redact = (value, key = '') => {
    if (PERSON_KEY.test(key) && value != null) return '[hidden]'
    if (Array.isArray(value)) return value.map((item) => redact(item))
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]))
    if ((CONTACT_KEY.test(key) || PERSON_KEY.test(key)) && value != null && value !== '') return '[hidden]'
    if (typeof value === 'string' && PHONE.test(value.replace(/[\s-]/g, ''))) return '[hidden]'
    return value
  }
  const send = (kind, url, body) => {
    try {
      let data = typeof body === 'string' ? JSON.parse(body) : body
      data = redact(data)
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
