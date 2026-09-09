import { describe, expect, it } from 'vitest'
import { mapSSHJumpHost, redactSSHJumpHost, toSSHJumpHostInput } from '@/lib/sshJumpHost'

describe('SSH jump host mapping', () => {
  it('keeps absent configuration disabled', () => {
    expect(toSSHJumpHostInput()).toBeUndefined()
    expect(mapSSHJumpHost(null)).toBeUndefined()
    expect(redactSSHJumpHost()).toBeUndefined()
  })

  it.each(['password', 'keyboard-interactive'] as const)('maps %s credentials for submission', (authMethod) => {
    const input = toSSHJumpHostInput({ host: ' bastion.internal ', port: 2222, username: ' admin ', authMethod, password: 'private', keyId: '99' })
    expect(input).toEqual({ host: 'bastion.internal', port: 2222, username: 'admin', auth_method: authMethod, password: 'private', key_id: null })
  })

  it('maps keys and never submits a stale password for non-password authentication', () => {
    const jump = { host: 'jump.internal', port: 22, username: 'admin', password: 'private' }
    expect(toSSHJumpHostInput({ ...jump, authMethod: 'key', keyId: '7' })).toMatchObject({ auth_method: 'key', key_id: 7, password: undefined })
    expect(toSSHJumpHostInput({ ...jump, authMethod: 'agent' })).toMatchObject({ auth_method: 'agent', key_id: null, password: undefined })
  })

  it('strips secrets from received and optimistic session state', () => {
    const original = { host: 'jump.internal', port: 22, username: 'admin', authMethod: 'password' as const, password: 'private' }
    expect(redactSSHJumpHost(original)).toEqual({ ...original, password: undefined })
    expect(original.password).toBe('private')
    expect(mapSSHJumpHost({ host: 'jump.internal', port: 22, username: 'admin', auth_method: 'key', key_id: 7, password: 'sealed-secret' }))
      .toEqual({ host: 'jump.internal', port: 22, username: 'admin', authMethod: 'key', keyId: '7' })
    expect(mapSSHJumpHost({ host: 'jump.internal', port: 22, username: 'admin', auth_method: 'agent' })?.keyId).toBeUndefined()
  })
})
