/** Loopback-only bind policy for local/dynamic tunnels (matches backend). */
export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized === '' || normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1') {
    return true
  }
  // IPv4 loopback range 127.0.0.0/8
  if (/^127(?:\.\d{1,3}){3}$/.test(normalized)) {
    return true
  }
  return false
}

export function normalizeTunnelLocalAddress(type: string, address: string): string {
  const trimmed = address.trim()
  if (trimmed === '') return '127.0.0.1'
  return trimmed
}

export function validateTunnelLocalAddress(type: string, address: string): string | null {
  if (type !== 'local' && type !== 'dynamic') return null
  const host = normalizeTunnelLocalAddress(type, address)
  if (!isLoopbackHost(host)) {
    return '本地/动态隧道只能绑定回环地址（127.0.0.1、::1、localhost）'
  }
  return null
}
