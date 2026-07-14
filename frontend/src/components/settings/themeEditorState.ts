import { completeAnsiPalette, normalizeTerminalThemeColors } from '@/components/settings/terminalThemeValidation'
import type { TerminalTheme } from '@/hooks/useSettings'
import type {
  TerminalGlobalStyle,
  TerminalGlobalStyleInput,
  ThemeAssignments,
  ThemeConfigurationInput,
  ThemeProfile,
  ThemeProfileInput,
} from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

export type ThemeEditorSlot = 'dark' | 'light' | 'fixed'
export type ThemeDraft = TerminalTheme & { followGlobalStyle: boolean }
export type ThemeDraftMap = Map<number, ThemeDraft>
const MAX_TERMINAL_FONT_FAMILY_RUNES = 256

export function validTerminalFontFamily(value: string): boolean {
  return value.trim() !== '' && [...value].length <= MAX_TERMINAL_FONT_FAMILY_RUNES
}

export function validTerminalFontSize(value: number): boolean {
  return Number.isInteger(value) && value >= 8 && value <= 48
}

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

export function buildThemeConfiguration(
  { profiles, drafts, assignments, globalStyle }: {
    profiles: ThemeProfile[]
    drafts: ThemeDraftMap
    assignments: ThemeAssignments
    globalStyle: TerminalGlobalStyle
  },
): ThemeConfigurationInput {
  const profileByID = new Map(profiles.map((profile) => [profile.id, profile]))
  const inputs = configurationProfileIDs(assignments).map((id) => {
    const profile = profileByID.get(id)
    if (!profile) throw new Error(`terminal theme Profile ${id} is unavailable`)
    const draft = drafts.get(id)
    if (!draft) throw new Error(`terminal theme draft ${id} is unavailable`)
    return themeToProfileInput(profile, draft)
  })
  return { global_style: terminalGlobalStyleInput(globalStyle), profiles: inputs, assignments }
}

export function effectiveDraftTheme(draft: ThemeDraft, globalStyle: TerminalGlobalStyle): TerminalTheme {
  const { followGlobalStyle: _, ...theme } = draft
  if (!draft.followGlobalStyle) return theme
  return {
    ...theme,
    fontFamily: globalStyle.font_family,
    fontSize: globalStyle.font_size,
    cursorStyle: globalStyle.cursor_style as TerminalTheme['cursorStyle'],
  }
}

export function terminalGlobalStyleInput(style: TerminalGlobalStyle): TerminalGlobalStyleInput {
  return {
    font_family: style.font_family,
    font_size: style.font_size,
    cursor_style: style.cursor_style,
  }
}

function profileToEditableTheme(profile: ThemeProfile): ThemeDraft {
  const colors = JSON.parse(profile.definition?.color_payload ?? '{}') as TerminalTheme & { cursor?: string; selection?: string }
  const overrides = JSON.parse(profile.color_overrides || '{}') as Partial<TerminalTheme> & { cursor?: string }
  return {
    ...normalizeTerminalThemeColors({ background: overrides.background ?? colors.background, foreground: overrides.foreground ?? colors.foreground, cursorColor: overrides.cursorColor ?? overrides.cursor ?? colors.cursor ?? colors.foreground, cursorStyle: profile.cursor_style as TerminalTheme['cursorStyle'], fontFamily: profile.font_family, fontSize: profile.font_size, ansi: completeAnsiPalette(overrides.ansi ?? colors.ansi ?? []) }),
    followGlobalStyle: profile.follow_global_style,
  }
}

function themeToProfileInput(profile: ThemeProfile, theme: ThemeDraft): ThemeProfileInput {
  const normalized = normalizeTerminalThemeColors(theme)
  return { id: profile.id, name: profile.name, theme_id: profile.theme_id, follow_global_style: theme.followGlobalStyle, font_family: normalized.fontFamily, font_size: normalized.fontSize, cursor_style: normalized.cursorStyle, color_overrides: JSON.stringify({ background: normalized.background, foreground: normalized.foreground, cursor: normalized.cursorColor, ansi: normalized.ansi }) } as ThemeProfileInput
}
