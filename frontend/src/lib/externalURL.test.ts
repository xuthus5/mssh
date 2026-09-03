import { describe, expect, it } from 'vitest'
import { normalizeExternalHTTPURL } from '@/lib/externalURL'

describe('normalizeExternalHTTPURL', () => {
  it('normalizes absolute HTTP and HTTPS URLs', () => {
    expect(normalizeExternalHTTPURL(' https://Example.com/docs?q=1 ')).toBe('https://example.com/docs?q=1')
    expect(normalizeExternalHTTPURL('http://example.com')).toBe('http://example.com/')
  })

  it.each([
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,unsafe',
    'mailto:ops@example.com',
    'https://user:secret@example.com/docs',
    'not a url',
  ])('rejects unsafe external URL %s', (value) => {
    expect(normalizeExternalHTTPURL(value)).toBeNull()
  })

  it('rejects empty and oversized URLs', () => {
    expect(normalizeExternalHTTPURL('   ')).toBeNull()
    expect(normalizeExternalHTTPURL(`https://example.com/${'a'.repeat(4096)}`)).toBeNull()
  })

  it.each([
    'http://localhost/admin',
    'http://127.0.0.1:8080',
    'http://10.0.0.2',
    'http://172.16.0.1',
    'http://192.168.1.1',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/',
    'http://[fd00::1]/',
    'http://service.local/',
    'http://metadata.google.internal/',
  ])('rejects local or private host %s', (value) => {
    expect(normalizeExternalHTTPURL(value)).toBeNull()
  })
})
