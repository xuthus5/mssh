import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const styles = readFileSync('src/styles/globals.css', 'utf8')
const appSource = readFileSync('src/App.tsx', 'utf8')

describe('terminal viewport styling', () => {
  it('applies the main-window alpha token to application surfaces', () => {
    expect(styles).toMatch(/--card:\s*oklch\(0\.205 0 0 \/ var\(--app-background-alpha\)\)/)
    expect(styles).toMatch(/--popover:\s*oklch\(0\.205 0 0 \/ var\(--app-background-alpha\)\)/)
    expect(styles).toMatch(/--sidebar:\s*oklch\(0\.205 0 0 \/ var\(--app-background-alpha\)\)/)
    expect(styles).toMatch(/\.light\s*\{[^}]*--card:\s*oklch\(1 0 0 \/ var\(--app-background-alpha\)\)/s)
    expect(styles).toMatch(/\.light\s*\{[^}]*--sidebar:\s*oklch\(0\.97 0 0 \/ var\(--app-background-alpha\)\)/s)
  })

  it('keeps the webview root transparent to avoid stacked background opacity', () => {
    expect(styles).toMatch(/body\s*\{\s*@apply text-foreground;/)
    expect(styles).not.toMatch(/body\s*\{\s*@apply bg-background text-foreground;/)
    expect(appSource).toContain('flex h-screen w-screen flex-col bg-transparent')
  })

  it('does not override xterm theme backgrounds with the application background token', () => {
    expect(styles).not.toMatch(/\.xterm\s+\.xterm-viewport\s*\{[^}]*background(?:-color)?\s*:/s)
  })

  it('hides the native scrollbar on the dynamic tab strip', () => {
    expect(styles).toMatch(/\.mssh-tab-strip-scroll\s*\{[^}]*scrollbar-width:\s*none\s*!important/s)
    expect(styles).toMatch(/\.mssh-tab-strip-scroll::\-webkit-scrollbar\s*\{[^}]*height:\s*0\s*!important/s)
  })
})
