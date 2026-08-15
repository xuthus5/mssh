import { describe, expect, it } from 'vitest'
import {
  matchSessionsForTrustedHost,
  normalizeTrustedHost,
  trustedHostFolderNames,
  trustedHostMatches,
} from '@/lib/trustedHostMatching'
import type { Folder, Session } from '@/lib/sessionModels'

function session(overrides: Partial<Session>): Session {
  return {
    id: '1', name: 'web-01', host: '10.0.0.1', port: 22, username: 'root',
    authMethod: 'password', keepAlive: 30, termType: 'xterm', folderId: null,
    ...overrides,
  }
}

const folder: Folder = { id: 'f1', name: '生产环境', parentId: null, isDefault: true }

describe('trustedHostMatching', () => {
  it('normalizes hosts by stripping ports and brackets', () => {
    expect(normalizeTrustedHost('10.0.0.1:22')).toBe('10.0.0.1')
    expect(normalizeTrustedHost('10.0.0.1')).toBe('10.0.0.1')
    expect(normalizeTrustedHost('[2001:db8::1]:22')).toBe('2001:db8::1')
    expect(normalizeTrustedHost('Db.Internal:22')).toBe('db.internal')
  })

  it('matches sessions by host and port', () => {
    const sessions = [
      session({ host: '10.0.0.1', port: 22 }),
      session({ id: '2', name: 'db', host: '10.0.0.2', port: 22 }),
    ]
    expect(matchSessionsForTrustedHost('10.0.0.1:22', sessions).map((item) => item.id)).toEqual(['1'])
    expect(matchSessionsForTrustedHost('10.0.0.1', sessions).map((item) => item.id)).toEqual(['1'])
    expect(matchSessionsForTrustedHost('10.0.0.3', sessions)).toEqual([])
  })

  it('ignores port mismatch when the entry has a different port', () => {
    const sessions = [session({ host: '10.0.0.1', port: 2222 })]
    expect(matchSessionsForTrustedHost('10.0.0.1:22', sessions)).toEqual([])
  })

  it('builds folder name index', () => {
    const names = trustedHostFolderNames([folder, { id: 'f2', name: '测试环境', parentId: 'f1', isDefault: false }])
    expect(names.get('f1')).toBe('生产环境')
    expect(names.get('f2')).toBe('测试环境')
  })

  it('matches search across session metadata', () => {
    const sessions = [session({ folderId: 'f1', environment: { id: 'e1', name: '生产', colorToken: 'blue', sortOrder: 0, sessionCount: 1 } })]
    const names = trustedHostFolderNames([folder])
    const match = (query: string) => trustedHostMatches({ hosts: '10.0.0.1:22', sessions, folderNames: names, algorithm: 'ssh-ed25519', fingerprint: 'SHA256:test', query })
    expect(match('web-01')).toBe(true)
    expect(match('生产环境')).toBe(true)
    expect(match('SHA256:test')).toBe(true)
    expect(match('10.0.0.1')).toBe(true)
    expect(match('missing')).toBe(false)
    expect(match('  ')).toBe(true)
  })
})
