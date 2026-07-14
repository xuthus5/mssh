import { describe, expect, it } from 'vitest'
import { profileToTerminalTheme } from '@/lib/terminalThemeCatalog'

const globalStyle = { font_family: 'Global Font', font_size: 15, cursor_style: 'bar' }
const profile = {
  id: 1,
  name: 'Dark',
  theme_id: 2,
  follow_global_style: false,
  font_family: 'Profile Font',
  font_size: 16,
  cursor_style: 'underline',
  color_overrides: JSON.stringify({ cursor: '#abcdef' }),
  created_at: '',
  updated_at: '',
  definition: {
    id: 2,
    name: 'Base',
    mode: 'dark',
    source_type: 'builtin',
    source_name: '',
    source_url: '',
    source_author: '',
    source_license: '',
    source_version: '',
    source_fingerprint: 'x',
    raw_payload: '',
    is_builtin: true,
    created_at: '',
    updated_at: '',
    color_payload: JSON.stringify({ background: '#000000', foreground: '#ffffff', cursor: '#ffffff', selection: '#123456', ansi: Array(16).fill('#111111') }),
  },
}

describe('profileToTerminalTheme', () => {
  it('merges definition colors and profile overrides with profile typography', () => {
    const result = profileToTerminalTheme(profile as never, globalStyle as never)

    expect(result).toMatchObject({ background: '#000000', foreground: '#ffffff', cursor: '#abcdef', selectionBackground: '#123456', fontFamily: 'Profile Font', fontSize: 16, cursorStyle: 'underline', ansiBlack: '#111111', ansiBrightWhite: '#111111' })
  })

  it('uses global typography without replacing the profile cursor color', () => {
    const result = profileToTerminalTheme({ ...profile, follow_global_style: true } as never, globalStyle as never)

    expect(result).toMatchObject({ cursor: '#abcdef', fontFamily: 'Global Font', fontSize: 15, cursorStyle: 'bar' })
  })
})
