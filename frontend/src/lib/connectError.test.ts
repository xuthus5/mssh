import { describe, expect, it } from 'vitest'
import { formatConnectError } from '@/lib/connectError'

const identity = (key: string) => key

describe('formatConnectError', () => {
  it('prefixes host-key change errors with commercial guidance', () => {
    const raw = 'connect: ssh: handshake failed: host key for example.com changed (possible MITM). expected [ssh-ed25519 SHA256:aaa]; presented ssh-ed25519 SHA256:bbb. connection blocked. remove the old fingerprint in Security settings if the change is expected'
    const out = formatConnectError(raw, identity)
    expect(out).toContain('主机密钥已变更')
    expect(out).toContain('SHA256:aaa')
    expect(out).toContain('SHA256:bbb')
  })

  it('returns empty fallback and passthrough', () => {
    expect(formatConnectError('', identity)).toBe('连接失败')
    expect(formatConnectError('network failed', identity)).toBe('network failed')
  })
})
