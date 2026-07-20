import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const styles = readFileSync('src/styles/globals.css', 'utf8')
const appSource = readFileSync('src/App.tsx', 'utf8')

describe('application styling', () => {
  it('keeps normal surfaces opaque and scopes native transparency to active windows', () => {
    expect(styles).toMatch(/--card:\s*oklch\(0\.205 0 0\)/)
    expect(styles).toMatch(/--popover:\s*oklch\(0\.205 0 0\)/)
    expect(styles).toMatch(/html\[data-native-transparency='active'\]\s*\{[^}]*--card:\s*oklch\(0\.205 0 0 \/ 78%\)/s)
    expect(styles).toMatch(/html\.light\[data-native-transparency='active'\]/)
  })

  it('keeps the normal webview opaque and exposes the native backdrop only when active', () => {
    expect(styles).toMatch(/body\s*\{\s*@apply bg-background text-foreground;/)
    expect(styles).toMatch(/html\[data-native-transparency='active'\] body/)
    expect(appSource).toContain('mssh-main-window flex h-screen w-screen flex-col bg-background')
  })

  it('does not override xterm theme backgrounds with the application background token', () => {
    expect(styles).not.toMatch(/\.xterm\s+\.xterm-viewport\s*\{[^}]*background(?:-color)?\s*:/s)
  })

  it('hides the native scrollbar on the dynamic tab strip', () => {
    expect(styles).toMatch(/\.mssh-tab-strip-scroll\s*\{[^}]*scrollbar-width:\s*none\s*!important/s)
    expect(styles).toMatch(/\.mssh-tab-strip-scroll::\-webkit-scrollbar\s*\{[^}]*height:\s*0\s*!important/s)
  })
})
