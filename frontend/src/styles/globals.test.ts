import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const styles = readFileSync('src/styles/globals.css', 'utf8')

describe('terminal viewport styling', () => {
  it('does not override xterm theme backgrounds with the application background token', () => {
    expect(styles).not.toMatch(/\.xterm\s+\.xterm-viewport\s*\{[^}]*background(?:-color)?\s*:/s)
  })
})
