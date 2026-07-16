import { describe, expect, it } from 'vitest'
import {
  buildThemeConfiguration,
  createThemeDrafts,
  effectiveDraftTheme,
  terminalGlobalStyleInput,
  validTerminalFontFamily,
  validTerminalFontSize,
} from '@/components/settings/themeEditorState'

const profiles = [profile(1, '#111111'), profile(2, '#eeeeee'), profile(3, '#333333')]
const globalStyle = { font_family: 'Global Font', font_size: 16, cursor_style: 'underline' as const, selection_background: '#123456' }

describe('theme editor state', () => {
  it('creates editable drafts keyed by Profile ID', () => {
    const drafts = createThemeDrafts(profiles as never)
    expect(drafts.get(1)?.background).toBe('#111111')
    expect(drafts.get(2)?.background).toBe('#eeeeee')
    expect(drafts.get(1)?.selectionBackground).toBe('#264f78')
  })

  it('deduplicates Profiles shared by Dark and Fixed assignments', () => {
    const drafts = createThemeDrafts(profiles as never)
    const configuration = buildThemeConfiguration({ profiles: profiles as never, drafts, assignments: {
      dark_profile_id: 1, light_profile_id: 2, follow_interface_mode: false, fixed_profile_id: 1,
    } as never, globalStyle: globalStyle as never })

    expect(configuration.profiles.map((profile) => profile.id)).toEqual([1, 2])
  })

  it('rejects an assignment whose Profile draft is unavailable', () => {
    const drafts = createThemeDrafts(profiles as never)
    drafts.delete(2)
    expect(() => buildThemeConfiguration({ profiles: profiles as never, drafts, assignments: {
      dark_profile_id: 1, light_profile_id: 2, follow_interface_mode: true, fixed_profile_id: 0,
    } as never, globalStyle: globalStyle as never })).toThrow('terminal theme draft 2 is unavailable')
  })

  it('keeps a historical fixed Profile draft when follow mode is re-enabled before saving', () => {
    const drafts = createThemeDrafts(profiles as never)
    const configuration = buildThemeConfiguration({ profiles: profiles as never, drafts, assignments: {
      dark_profile_id: 1, light_profile_id: 2, follow_interface_mode: true, fixed_profile_id: 3,
    } as never, globalStyle: globalStyle as never })

    expect(configuration.profiles.map((profile) => profile.id)).toEqual([1, 2, 3])
  })

  it('resolves global style without mutating Profile fallback values', () => {
    const draft = createThemeDrafts(profiles as never).get(1)
    if (!draft) throw new Error('missing draft')

    const effective = effectiveDraftTheme(draft, globalStyle as never)

    expect(effective).toMatchObject({ fontFamily: 'Global Font', fontSize: 16, cursorStyle: 'underline', selectionBackground: '#123456' })
    expect(draft).toMatchObject({ fontFamily: 'Profile Font 1', fontSize: 13, cursorStyle: 'bar', selectionBackground: '#264f78', followGlobalStyle: true })
  })

  it('restores the Profile fallback values when global following is disabled', () => {
    const draft = createThemeDrafts(profiles as never).get(1)
    if (!draft) throw new Error('missing draft')

    const effective = effectiveDraftTheme({ ...draft, followGlobalStyle: false }, globalStyle as never)

    expect(effective).toMatchObject({ fontFamily: 'Profile Font 1', fontSize: 13, cursorStyle: 'bar', selectionBackground: '#264f78' })
    expect(effective.cursorColor).toBe('#ffffff')
  })

  it('builds one atomic configuration with global and Profile follow settings', () => {
    const drafts = createThemeDrafts(profiles as never)
    const independent = drafts.get(2)
    if (!independent) throw new Error('missing draft')
    drafts.set(2, { ...independent, followGlobalStyle: false, fontFamily: 'Independent Font', fontSize: 18, cursorStyle: 'block' })

    const configuration = buildThemeConfiguration({ profiles: profiles as never, drafts, assignments: {
      dark_profile_id: 1, light_profile_id: 2, follow_interface_mode: true, fixed_profile_id: 0,
    } as never, globalStyle: globalStyle as never })

    expect(configuration.global_style).toEqual(terminalGlobalStyleInput(globalStyle as never))
    expect(configuration.profiles).toContainEqual(expect.objectContaining({ id: 1, follow_global_style: true, font_family: 'Profile Font 1' }))
    expect(configuration.profiles).toContainEqual(expect.objectContaining({ id: 2, follow_global_style: false, font_family: 'Independent Font', font_size: 18, cursor_style: 'block' }))
    const independentProfile = configuration.profiles.find((profile) => profile.id === 2)
    expect(JSON.parse(independentProfile?.color_overrides ?? '{}')).toMatchObject({ selection: '#264f78' })
  })

  it('validates terminal typography boundaries', () => {
    expect(validTerminalFontFamily('')).toBe(false)
    expect(validTerminalFontFamily('字'.repeat(256))).toBe(true)
    expect(validTerminalFontFamily('字'.repeat(257))).toBe(false)
    expect(validTerminalFontSize(8)).toBe(true)
    expect(validTerminalFontSize(48)).toBe(true)
    expect(validTerminalFontSize(7)).toBe(false)
    expect(validTerminalFontSize(Number.NaN)).toBe(false)
  })
})

function profile(id: number, background: string) {
  return {
    id,
    name: `Profile ${id}`,
    theme_id: id,
    follow_global_style: true,
    font_family: `Profile Font ${id}`,
    font_size: 12 + id,
    cursor_style: 'bar',
    color_overrides: '{}',
    definition: {
      color_payload: JSON.stringify({ background, foreground: '#ffffff', cursor: '#ffffff', selection: '#264f78', ansi: Array(16).fill('#111111') }),
    },
  }
}
