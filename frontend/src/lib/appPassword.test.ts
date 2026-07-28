import { describe, expect, it } from 'vitest'
import { validateAppPassword } from '@/lib/appPassword'

describe('validateAppPassword', () => {
  it.each([
    ['short password', 'short', true, '应用密码至少需要 12 个字符'],
    ['astral characters below minimum', '🔐'.repeat(6), true, '应用密码至少需要 12 个字符'],
    ['minimum accepted', 'twelve chars', true, ''],
    ['maximum accepted', 'x'.repeat(1024), true, ''],
    ['ASCII over maximum', 'x'.repeat(1025), true, '应用密码不能超过 1024 字节'],
    ['UTF-8 over maximum', '密'.repeat(342), true, '应用密码不能超过 1024 字节'],
    ['unlock skips minimum', 'short', false, ''],
  ])('%s', (_name, password, requireMinimum, expected) => {
    expect(validateAppPassword(password as string, requireMinimum as boolean)).toBe(expected)
  })
})
