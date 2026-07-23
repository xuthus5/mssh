import { describe, expect, it } from 'vitest'
import {
  isLoopbackHost,
  normalizeTunnelLocalAddress,
  remoteTunnelExposureWarning,
  validateTunnelLocalAddress,
} from '@/lib/tunnelBind'

describe('tunnelBind', () => {
  it('accepts loopback hosts and rejects public binds for local/dynamic', () => {
    expect(isLoopbackHost('')).toBe(true)
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('::1')).toBe(true)
    expect(isLoopbackHost('[::1]')).toBe(true)
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('127.1.2.3')).toBe(true)
    expect(isLoopbackHost('0.0.0.0')).toBe(false)
    expect(isLoopbackHost('192.168.1.1')).toBe(false)

    expect(validateTunnelLocalAddress('dynamic', '0.0.0.0')).toMatch(/回环/)
    expect(validateTunnelLocalAddress('local', '')).toBeNull()
    expect(validateTunnelLocalAddress('remote', '0.0.0.0')).toBeNull()
    expect(normalizeTunnelLocalAddress('dynamic', '  ')).toBe('127.0.0.1')
  })

  it('warns on wildcard and non-loopback remote listens', () => {
    expect(remoteTunnelExposureWarning('local', '0.0.0.0')).toBeNull()
    expect(remoteTunnelExposureWarning('remote', '127.0.0.1')).toBeNull()
    expect(remoteTunnelExposureWarning('remote', '0.0.0.0')).toMatch(/0\.0\.0\.0/)
    expect(remoteTunnelExposureWarning('remote', '::')).toMatch(/0\.0\.0\.0/)
    expect(remoteTunnelExposureWarning('remote', '192.168.1.10')).toMatch(/非回环/)
  })
})
