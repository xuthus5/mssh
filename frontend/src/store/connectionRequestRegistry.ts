const MAX_RETIRED_REQUESTS = 256
const retiredRequests = new Set<string>()
const listeners = new Set<(requestId: string) => void>()

export function isRetiredConnectionRequest(requestId?: string) {
  return Boolean(requestId && retiredRequests.has(requestId))
}

/** 仅登记客户端已取消或替换的请求；未知后台请求仍走正常指纹确认。 */
export function retireConnectionRequest(requestId: string) {
  if (!requestId || retiredRequests.has(requestId)) return
  retiredRequests.add(requestId)
  if (retiredRequests.size > MAX_RETIRED_REQUESTS) {
    const oldest = retiredRequests.values().next().value
    if (oldest) retiredRequests.delete(oldest)
  }
  for (const listener of listeners) listener(requestId)
}

export function subscribeRetiredConnectionRequests(listener: (requestId: string) => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
