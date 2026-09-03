const MAX_EXTERNAL_URL_LENGTH = 4096

export function normalizeExternalHTTPURL(value: string): string | null {
  const candidate = value.trim()
  if (!candidate || candidate.length > MAX_EXTERNAL_URL_LENGTH) return null

  try {
    const url = new URL(candidate)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (!url.hostname || url.username || url.password) return null
    if (isBlockedExternalHostname(url.hostname)) return null
    return url.toString()
  } catch {
    return null
  }
}

function isBlockedExternalHostname(rawHostname: string): boolean {
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return true
  if (hostname === 'metadata.google.internal' || hostname === 'metadata') return true
  if (hostname.includes(':')) {
    return hostname === '::' || hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe8') || hostname.startsWith('fe9') || hostname.startsWith('fea') || hostname.startsWith('feb')
  }
  const octets = hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false
  const [first, second] = octets
  return first === 0 || first === 10 || first === 127 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) || (first === 100 && second >= 64 && second <= 127)
}
