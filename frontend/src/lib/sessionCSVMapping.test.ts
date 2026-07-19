import { describe, expect, it } from 'vitest'
import {
  buildSessionCSVMapping,
  detectSessionCSVProvider,
  missingSessionCSVFields,
  normalizeSessionCSVHeader,
  sessionCSVDefaults,
  sessionCSVSample,
  updateSessionCSVMapping,
} from '@/lib/sessionCSVMapping'

describe('sessionCSVMapping', () => {
  it('detects native and common client field templates', () => {
    expect(detectSessionCSVProvider(['name', 'host', 'port', 'username', 'auth_method', 'password', 'key_name', 'key_public_key', 'folder_path', 'environment', 'project', 'tags', 'notes', 'keep_alive', 'term_type', 'format_version'])).toBe('mssh')
    expect(detectSessionCSVProvider(['Saved Session', 'HostName', 'AutoLoginUsername'])).toBe('putty')
    expect(detectSessionCSVProvider(['Session', 'Hostname', 'Session Path', 'Terminal Emulation'])).toBe('securecrt')
    expect(detectSessionCSVProvider(['Bookmark', 'Remote host', 'Username'])).toBe('mobaxterm')
    expect(detectSessionCSVProvider(['Label', 'Machine'])).toBe('custom')
  })

  it('builds mappings from aliases without reusing source columns', () => {
    const mapping = buildSessionCSVMapping('mobaxterm', ['Bookmark', 'Remote host', 'Username', 'Description'])
    expect(mapping).toMatchObject({ name: 'Bookmark', host: 'Remote host', username: 'Username', notes: 'Description' })
    expect(Object.values(mapping).filter(Boolean)).toHaveLength(4)

    const updated = updateSessionCSVMapping(mapping, 'notes', 'Bookmark')
    expect(updated.name).toBe('')
    expect(updated.notes).toBe('Bookmark')
  })

  it('reports missing required fields while accepting defaults', () => {
    const defaults = sessionCSVDefaults()
    const mapping = buildSessionCSVMapping('custom', ['Name', 'Host'])
    expect(missingSessionCSVFields(mapping, defaults).map((field) => field.key)).toEqual(['username'])
    expect(missingSessionCSVFields(mapping, { ...defaults, username: 'root' })).toEqual([])
  })

  it('normalizes headings and reads the first non-empty sample', () => {
    expect(normalizeSessionCSVHeader(' Remote_Host ')).toBe('remote host')
    expect(sessionCSVSample(['Name', 'Host'], [['one', ''], ['two', '10.0.0.2']], 'Host')).toBe('10.0.0.2')
    expect(sessionCSVSample(['Name'], [['one']], 'Missing')).toBe('')
  })
})
