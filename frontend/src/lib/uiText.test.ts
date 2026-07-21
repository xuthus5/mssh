import { describe, expect, it } from 'vitest'
import { t, uiText } from '@/lib/uiText'

describe('uiText', () => {
  it('resolves registered keys', () => {
    expect(t('newSession')).toBe(uiText.newSession)
    expect(t('macrosNeedTerminal')).toContain('终端')
    expect(Object.keys(uiText).length).toBeGreaterThan(10)
  })
})
