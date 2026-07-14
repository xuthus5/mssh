import { describe, expect, it } from 'vitest'
import { effectiveTerminalProfileID, resolveEffectiveTerminalProfile } from '@/lib/effectiveTerminalTheme'

const profiles = [{ id: 1 }, { id: 2 }, { id: 3 }]

describe('effective terminal theme', () => {
  it.each([
    ['dark', true, 1],
    ['light', true, 2],
    ['dark', false, 3],
    ['light', false, 3],
  ] as const)('resolves %s mode with follow=%s', (mode, follow, expected) => {
    expect(effectiveTerminalProfileID({
      dark_profile_id: 1,
      light_profile_id: 2,
      follow_interface_mode: follow,
      fixed_profile_id: 3,
    } as never, mode)).toBe(expected)
  })

  it('reports an unavailable effective profile', () => {
    expect(() => resolveEffectiveTerminalProfile({
      dark_profile_id: 1,
      light_profile_id: 2,
      follow_interface_mode: false,
      fixed_profile_id: 9,
    } as never, 'dark', profiles as never)).toThrow('terminal theme profile 9 is unavailable')
  })
})
