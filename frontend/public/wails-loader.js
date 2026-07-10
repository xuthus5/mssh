// Wails v3 runtime loader — runs before React app
// Served as static file (not processed by Vite)
window.__wailsReady = import('/wails/runtime.js').then(function(m) {
  window.__wailsRuntime = m
  console.log('[wails-loader] runtime loaded, keys:', Object.keys(m).join(', '))
  return m
}).catch(function(e) {
  console.log('[wails-loader] import failed:', e.message)
  return null
})
