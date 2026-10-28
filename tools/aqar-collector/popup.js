const count = document.getElementById('count')
const refresh = () => chrome.storage.local.get({ records: [] }, ({ records }) => {
  count.textContent = `${records.length} استجابة مسجّلة`
})
document.getElementById('export').addEventListener('click', () => {
  chrome.storage.local.get({ records: [] }, ({ records }) => {
    const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), records })], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `aqar-discovery-${Date.now()}.json`
    link.click()
  })
})
document.getElementById('clear').addEventListener('click', () => chrome.storage.local.set({ records: [] }, refresh))
refresh()
