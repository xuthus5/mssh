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
})
