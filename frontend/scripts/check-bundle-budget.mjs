import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('src')
const maxEagerImportHits = {
  // These packages must not be statically imported from main App entry.
  '@xterm/xterm': { allowIn: ['components/terminal', 'hooks', 'store', 'lib/terminal', 'test'] },
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

const appEntry = path.join(root, 'App.tsx')
const appSource = fs.readFileSync(appEntry, 'utf8')
const staticXterm = /^import\s+.*from\s+['"]@xterm\//m.test(appSource)
if (staticXterm) {
  console.error('Bundle budget: App.tsx must not statically import @xterm/* (keep terminal lazy).')
  process.exit(1)
}

// Terminal layers must remain dynamically imported
const layersCandidates = [
  path.join(root, 'components/terminal/TerminalLayers.tsx'),
  path.join(root, 'components/layout/TerminalLayers.tsx'),
  path.join(root, 'App.tsx'),
]
let foundLazy = false
for (const file of layersCandidates) {
  if (!fs.existsSync(file)) continue
  const source = fs.readFileSync(file, 'utf8')
  if (source.includes('import(') && (source.includes('TerminalPane') || source.includes('terminal/') || source.includes('Playback') || source.includes('FilePanel') || source.includes('SFTP') || source.includes('lazy'))) {
    foundLazy = true
  }
  if (/React\.lazy|lazy\(/.test(source)) foundLazy = true
}
// Also search components for lazy terminal shell
const files = walk(path.join(root, 'components'))
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  if ((/lazy\(/.test(source) || /import\(/.test(source)) && /terminal|Terminal|Playback|FilePanel|SFTP/i.test(source)) {
    foundLazy = true
    break
  }
}
if (!foundLazy) {
  console.error('Bundle budget: expected lazy/dynamic import for heavy terminal/SFTP modules.')
  process.exit(1)
}

console.log('OK: bundle budget checks passed (no eager xterm in App; lazy heavy modules present)')
