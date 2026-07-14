import type { ThemeAssignments, ThemeProfile } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'

export type ColorMode = 'dark' | 'light'

export function effectiveTerminalProfileID(assignments: ThemeAssignments, colorMode: ColorMode): number {
  if (!assignments.follow_interface_mode) return assignments.fixed_profile_id
  return colorMode === 'dark' ? assignments.dark_profile_id : assignments.light_profile_id
}

export function resolveEffectiveTerminalProfile(assignments: ThemeAssignments, colorMode: ColorMode, profiles: ThemeProfile[]): ThemeProfile {
  const profileID = effectiveTerminalProfileID(assignments, colorMode)
  const profile = profiles.find((item) => item.id === profileID)
  if (!profile) throw new Error(`terminal theme profile ${profileID} is unavailable`)
  return profile
}
