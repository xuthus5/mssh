import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const styles = readFileSync('src/styles/globals.css', 'utf8')
const appSource = readFileSync('src/App.tsx', 'utf8')

describe('application styling', () => {
  it('keeps application surfaces opaque', () => {
    expect(styles).toMatch(/--card:\s*oklch\(0\.205 0 0\)/)
    expect(styles).toMatch(/--popover:\s*oklch\(0\.205 0 0\)/)
    expect(styles).not.toContain('data-native-transparency')
  })

  it('keeps the webview opaque', () => {
    expect(styles).toMatch(/body\s*\{\s*@apply bg-background text-foreground;/)
    expect(appSource).toContain('flex h-screen w-screen flex-col bg-background')
    expect(appSource).not.toContain('mssh-main-window')
  })

  it('does not override xterm theme backgrounds with the application background token', () => {
    expect(styles).not.toMatch(/\.xterm\s+\.xterm-viewport\s*\{[^}]*background(?:-color)?\s*:/s)
  })

  it('hides the native scrollbar on the dynamic tab strip', () => {
    expect(styles).toMatch(/\.mssh-tab-strip-scroll\s*\{[^}]*scrollbar-width:\s*none\s*!important/s)
    expect(styles).toMatch(/\.mssh-tab-strip-scroll::\-webkit-scrollbar\s*\{[^}]*height:\s*0\s*!important/s)
  })
})
