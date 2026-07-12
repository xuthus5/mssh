import { describe, expect, it } from 'vitest'
import { profileToTerminalTheme } from '@/lib/terminalThemeCatalog'

describe('profileToTerminalTheme', () => {
  it('merges definition colors and profile overrides', () => {
    const result = profileToTerminalTheme({
      id: 1, name: 'Dark', theme_id: 2, font_family: 'JetBrains Mono', font_size: 16, cursor_style: 'underline',
      color_overrides: JSON.stringify({ cursor: '#abcdef' }), created_at: '', updated_at: '',
      definition: {
        id: 2, name: 'Base', mode: 'dark', source_type: 'builtin', source_name: '', source_url: '', source_author: '', source_license: '', source_version: '', source_fingerprint: 'x', raw_payload: '', is_builtin: true, created_at: '', updated_at: '',
        color_payload: JSON.stringify({ background: '#000000', foreground: '#ffffff', cursor: '#ffffff', selection: '#123456', ansi: Array(16).fill('#111111') }),
      },
    } as never)

    expect(result).toMatchObject({ background: '#000000', foreground: '#ffffff', cursor: '#abcdef', selectionBackground: '#123456', fontFamily: 'JetBrains Mono', fontSize: 16, cursorStyle: 'underline', ansiBlack: '#111111', ansiBrightWhite: '#111111' })
  })
})
