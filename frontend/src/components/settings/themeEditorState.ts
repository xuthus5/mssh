import { completeAnsiPalette, normalizeTerminalThemeColors } from '@/components/settings/terminalThemeValidation'
import type { TerminalTheme } from '@/hooks/useSettings'
import type { ThemeAssignments, ThemeConfigurationInput, ThemeProfile, ThemeProfileInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

export type ThemeEditorSlot = 'dark' | 'light' | 'fixed'
export type ThemeDraftMap = Map<number, TerminalTheme>

export function createThemeDrafts(profiles: ThemeProfile[]): ThemeDraftMap {
  return new Map(profiles.map((profile) => [profile.id, profileToEditableTheme(profile)]))
}

export function profileIDForSlot(slot: ThemeEditorSlot, assignments: ThemeAssignments): number {
  if (slot === 'fixed') return assignments.fixed_profile_id
  return slot === 'dark' ? assignments.dark_profile_id : assignments.light_profile_id
}

export function configurationProfileIDs(assignments: ThemeAssignments): number[] {
  const ids = new Set([assignments.dark_profile_id, assignments.light_profile_id])
  if (assignments.fixed_profile_id > 0) ids.add(assignments.fixed_profile_id)
  return [...ids]
}

export function buildThemeConfiguration(profiles: ThemeProfile[], drafts: ThemeDraftMap, assignments: ThemeAssignments): ThemeConfigurationInput {
  const profileByID = new Map(profiles.map((profile) => [profile.id, profile]))
  const inputs = configurationProfileIDs(assignments).map((id) => {
    const profile = profileByID.get(id)
    if (!profile) throw new Error(`terminal theme Profile ${id} is unavailable`)
    const draft = drafts.get(id)
    if (!draft) throw new Error(`terminal theme draft ${id} is unavailable`)
    return themeToProfileInput(profile, draft)
  })
  return { profiles: inputs, assignments }
}

function profileToEditableTheme(profile: ThemeProfile): TerminalTheme {
  const colors = JSON.parse(profile.definition?.color_payload ?? '{}') as TerminalTheme & { cursor?: string; selection?: string }
  const overrides = JSON.parse(profile.color_overrides || '{}') as Partial<TerminalTheme> & { cursor?: string }
  return normalizeTerminalThemeColors({ background: overrides.background ?? colors.background, foreground: overrides.foreground ?? colors.foreground, cursorColor: overrides.cursorColor ?? overrides.cursor ?? colors.cursor ?? colors.foreground, cursorStyle: profile.cursor_style as TerminalTheme['cursorStyle'], fontFamily: profile.font_family, fontSize: profile.font_size, ansi: completeAnsiPalette(overrides.ansi ?? colors.ansi ?? []) })
}

function themeToProfileInput(profile: ThemeProfile, theme: TerminalTheme): ThemeProfileInput {
  const normalized = normalizeTerminalThemeColors(theme)
  return { id: profile.id, name: profile.name, theme_id: profile.theme_id, font_family: normalized.fontFamily, font_size: normalized.fontSize, cursor_style: normalized.cursorStyle, color_overrides: JSON.stringify({ background: normalized.background, foreground: normalized.foreground, cursor: normalized.cursorColor, ansi: normalized.ansi }) } as ThemeProfileInput
}
