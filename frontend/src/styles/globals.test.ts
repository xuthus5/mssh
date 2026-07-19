import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const styles = readFileSync('src/styles/globals.css', 'utf8')

describe('terminal viewport styling', () => {
  it('does not override xterm theme backgrounds with the application background token', () => {
    expect(styles).not.toMatch(/\.xterm\s+\.xterm-viewport\s*\{[^}]*background(?:-color)?\s*:/s)
  })

  it('hides the native scrollbar on the dynamic tab strip', () => {
    expect(styles).toMatch(/\.mssh-tab-strip-scroll\s*\{[^}]*scrollbar-width:\s*none\s*!important/s)
    expect(styles).toMatch(/\.mssh-tab-strip-scroll::\-webkit-scrollbar\s*\{[^}]*height:\s*0\s*!important/s)
  })
})
