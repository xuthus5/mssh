import { describe, expect, it } from 'vitest'
import { buildThemeConfiguration, createThemeDrafts } from '@/components/settings/themeEditorState'

const profiles = [profile(1, '#111111'), profile(2, '#eeeeee')]

describe('theme editor state', () => {
  it('creates editable drafts keyed by Profile ID', () => {
    const drafts = createThemeDrafts(profiles as never)
    expect(drafts.get(1)?.background).toBe('#111111')
    expect(drafts.get(2)?.background).toBe('#eeeeee')
  })

  it('deduplicates Profiles shared by Dark and Fixed assignments', () => {
    const drafts = createThemeDrafts(profiles as never)
    const configuration = buildThemeConfiguration(profiles as never, drafts, {
      dark_profile_id: 1,
      light_profile_id: 2,
      follow_interface_mode: false,
      fixed_profile_id: 1,
    } as never)

    expect(configuration.profiles.map((profile) => profile.id)).toEqual([1, 2])
  })

  it('rejects an assignment whose Profile draft is unavailable', () => {
    const drafts = createThemeDrafts(profiles as never)
    drafts.delete(2)
    expect(() => buildThemeConfiguration(profiles as never, drafts, {
      dark_profile_id: 1,
      light_profile_id: 2,
      follow_interface_mode: true,
      fixed_profile_id: 0,
    } as never)).toThrow('terminal theme draft 2 is unavailable')
  })
})

function profile(id: number, background: string) {
  return {
    id,
    name: `Profile ${id}`,
    theme_id: id,
    font_family: 'monospace',
    font_size: 14,
    cursor_style: 'bar',
    color_overrides: '{}',
    definition: {
      color_payload: JSON.stringify({ background, foreground: '#ffffff', cursor: '#ffffff', selection: '#264f78', ansi: Array(16).fill('#111111') }),
    },
  }
}
