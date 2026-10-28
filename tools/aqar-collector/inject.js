// Runs in the page itself. Aqar's map asks its GraphQL endpoint for listings (Web.find) and gets each one with its
// location, district id, link, price, rent period and photos. Every such answer, and the request that produced it
// (body and headers), is handed to relay.js as received.
(() => {
  const realFetch = window.fetch
  const headersOf = (init) => {
    try { return Object.fromEntries(new Headers(init?.headers || {}).entries()) } catch { return {} }
  }
  window.fetch = async function (input, init) {
    const response = await realFetch.apply(this, arguments)
    try {
      const url = typeof input === 'string' ? input : input?.url
      const body = typeof init?.body === 'string' ? init.body : null
      if (url && url.includes('/graphql') && body && body.includes('find')) {
        response.clone().text().then((text) => {
          if (text.includes('"find"')) window.postMessage({ source: 'farq-aqar', url: String(url), request: body, headers: headersOf(init), response: text, page: location.href }, '*')
        }).catch(() => {})
      }
    } catch { /* never break the page */ }
    return response
  }
})()
