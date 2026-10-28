// Runs in the page itself. Aqar's map asks its GraphQL endpoint for listings (Web.find) and gets each one with its
// location, district id, link, price, rent period and photos. Every such answer, and the request that produced it
// (body and headers), is handed to relay.js as received; so is any request behind «اتصال» or «محادثة».
(() => {
  const CONTACT = /phone|mobile|call|contact|chat|conversation|whatsapp|reveal/i
  const realFetch = window.fetch
  const headersOf = (init) => {
    try { return Object.fromEntries(new Headers(init?.headers || {}).entries()) } catch { return {} }
  }
  window.fetch = async function (input, init) {
    const response = await realFetch.apply(this, arguments)
    try {
      const url = typeof input === 'string' ? input : input?.url
      const body = typeof init?.body === 'string' ? init.body : null
      // what the page asks when someone presses «اتصال» or «محادثة»: kept as samples, so the collecting mode can ask
      // the same for every listing
      if (url && CONTACT.test(`${url} ${body || ''}`) && !/\/api\/v1\/events/.test(url)) {
        response.clone().text().then((text) => window.postMessage({ source: 'farq-aqar', type: 'contact', url: String(url), request: body, headers: headersOf(init), response: text.slice(0, 20000), page: location.href }, '*')).catch(() => {})
      }
      if (url && url.includes('/graphql') && body && body.includes('find')) {
        response.clone().text().then((text) => {
          if (text.includes('"find"')) window.postMessage({ source: 'farq-aqar', url: String(url), request: body, headers: headersOf(init), response: text, page: location.href }, '*')
        }).catch(() => {})
      }
    } catch { /* never break the page */ }
    return response
  }

  // the fast run's requests go out from here, as the page's own, with its session and in its own way
  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.data?.source !== 'farq-aqar-ask') return
    const { id, url, body, headers } = event.data
    try {
      const response = await realFetch(url, { method: 'POST', credentials: 'include', headers, body })
      const text = await response.text()
      window.postMessage({ source: 'farq-aqar-answer', id, status: response.status, retryAfter: response.headers.get('retry-after'), text }, '*')
    } catch (error) {
      window.postMessage({ source: 'farq-aqar-answer', id, status: 0, error: String(error?.message || error) }, '*')
    }
  })

  const open = XMLHttpRequest.prototype.open
  const send = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (method, url, ...rest) { this.__farqUrl = String(url); return open.call(this, method, url, ...rest) }
  XMLHttpRequest.prototype.send = function (body) {
    const url = this.__farqUrl || ''
    if (CONTACT.test(`${url} ${typeof body === 'string' ? body : ''}`)) {
      this.addEventListener('load', () => {
        try { window.postMessage({ source: 'farq-aqar', type: 'contact', url, request: typeof body === 'string' ? body : null, headers: {}, response: String(this.responseText).slice(0, 20000), page: location.href }, '*') } catch { /* ignore */ }
      })
    }
    return send.call(this, body)
  }
})()
