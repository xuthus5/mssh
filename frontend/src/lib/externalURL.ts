const MAX_EXTERNAL_URL_LENGTH = 4096

export function normalizeExternalHTTPURL(value: string): string | null {
  const candidate = value.trim()
  if (!candidate || candidate.length > MAX_EXTERNAL_URL_LENGTH) return null

  try {
    const url = new URL(candidate)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (!url.hostname || url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}
