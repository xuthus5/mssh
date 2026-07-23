/** Best-effort path normalization for matching serial device identities in the UI. */
export function normalizeSerialDeviceKey(device: string | null | undefined): string {
  const raw = String(device ?? '').trim()
  if (!raw) return ''

  // Windows COM ports compare case-insensitively by bare name (COM3).
  const upper = raw.toUpperCase()
  const com = upper.match(/COM\d+$/)
  if (com && (upper === com[0] || upper.endsWith(com[0]))) {
    // Treat bare COM and \\.\COM forms as the same key.
    const onlyCom = upper === com[0]
    const devicePrefix = upper.length - com[0].length
    const prefix = upper.slice(0, devicePrefix)
    if (onlyCom || prefix === '\\\\.\\' || prefix.endsWith('\\\\.\\')) return com[0]
  }

  // Unix-ish paths: collapse separators and ./ segments
  let path = raw.replaceAll('\\', '/')
  while (path.includes('//')) path = path.replaceAll('//', '/')
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)

  const parts: string[] = []
  const absolute = path.startsWith('/')
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length > 0) parts.pop()
      continue
    }
    parts.push(part)
  }
  return absolute ? `/${parts.join('/')}` : parts.join('/')
}

export function isSerialDeviceActive(
  device: string | null | undefined,
  activeDevices: Record<string, string> | null | undefined,
): boolean {
  const key = normalizeSerialDeviceKey(device)
  if (!key || !activeDevices) return false
  if (activeDevices[device ?? '']) return true
  if (activeDevices[key]) return true
  return Object.keys(activeDevices).some((item) => normalizeSerialDeviceKey(item) === key)
}

export function isSerialDevicePresent(
  device: string | null | undefined,
  devices: string[] | null | undefined,
): boolean {
  const key = normalizeSerialDeviceKey(device)
  if (!key || !devices?.length) return false
  if (devices.includes(device ?? '')) return true
  return devices.some((item) => normalizeSerialDeviceKey(item) === key)
}
