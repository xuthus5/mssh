import { clientId, setTransport } from '@wailsio/runtime'

interface WsPending {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
}

interface WsMessage {
  id?: string
  ok?: boolean
  type?: 'text' | 'json' | 'event'
  data?: string
  error?: string
  event?: unknown
}

let ws: WebSocket | null = null
let ready = false
const pending = new Map<string, WsPending>()

function dispatchEvent(message: WsMessage): void {
  const wails = (window as unknown as { _wails?: { dispatchWailsEvent?: (event: unknown) => void } })._wails
  wails?.dispatchWailsEvent?.(message.event)
}

function handleMessage(message: WsMessage): void {
  if (message && typeof message.id === 'string') {
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    if (message.ok) {
      if (message.type === 'json' && typeof message.data === 'string') {
        try {
          waiter.resolve(JSON.parse(message.data))
        } catch (error) {
          waiter.reject(error)
        }
        return
      }
      waiter.resolve(message.data)
      return
    }
    waiter.reject(new Error(message.error || 'wails runtime call failed'))
    return
  }
  if (message && message.type === 'event') dispatchEvent(message)
}

function currentWindowName(): string {
  return new URLSearchParams(window.location.search).get('window') === 'settings' ? 'settings' : 'main'
}

interface CallRequest {
  objectID: number
  method: number
  windowName: string
  args: unknown
}

function callViaHTTP(call: CallRequest): Promise<unknown> {
  const url = new URL(window.location.origin + '/wails/runtime')
  const body: Record<string, unknown> = { object: call.objectID, method: call.method }
  if (call.args !== null && call.args !== undefined) body.args = call.args
  const headers: Record<string, string> = { 'x-wails-client-id': clientId, 'Content-Type': 'application/json' }
  if (call.windowName) headers['x-wails-window-name'] = call.windowName
  return fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }).then(async (response) => {
    const contentType = response.headers.get('Content-Type') || ''
    if (!response.ok) {
      if (contentType.includes('application/json')) {
        const json = await response.json()
        const error = new Error(json.message || 'wails runtime call failed')
        ;(error as Error & { cause?: unknown }).cause = json.cause
        throw error
      }
      throw new Error(await response.text())
    }
    if (contentType.includes('application/json')) return response.json()
    return response.text()
  })
}

function connect(url: string): void {
  const socket = new WebSocket(url)
  ws = socket
  socket.onmessage = (event) => {
    try {
      handleMessage(JSON.parse(event.data as string) as WsMessage)
    } catch {
      // Ignore malformed frames.
    }
  }
  socket.onopen = () => {
    ready = true
  }
  socket.onclose = () => {
    ready = false
    for (const [, waiter] of pending) waiter.reject(new Error('wails transport disconnected'))
    pending.clear()
    if (ws === socket) ws = null
  }
}

function callViaWebSocket(call: CallRequest): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('wails transport not ready'))
      return
    }
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    pending.set(id, { resolve, reject })
    try {
      ws.send(JSON.stringify({
        id,
        object: call.objectID,
        method: call.method,
        args: call.args ?? null,
        windowName: call.windowName,
      }))
    } catch (error) {
      pending.delete(id)
      reject(error)
    }
  })
}

/**
 * Loads the backend-provided /wails/transport.js, which injects
 * window.__wailsWSURL with the runtime WebSocket address. Must run before
 * initWsTransport's probe reaches the URL.
 */
export async function loadWailsTransport(): Promise<void> {
  try {
    const response = await fetch('/wails/transport.js')
    if (!response.ok) return
    const source = await response.text()
    const script = document.createElement('script')
    script.textContent = source
    document.head.appendChild(script)
  } catch {
    // WebSocket unavailable; the HTTP fallback keeps the app functional.
  }
}

/**
 * Replaces the default HTTP-fetch transport with a WebSocket-priority
 * transport. The backend exposes the runtime WS URL via /wails/transport.js
 * (window.__wailsWSURL). Calls fall back to HTTP /wails/runtime whenever the
 * socket is not connected, so startup and disconnects never block.
 */
export function initWsTransport(): void {
  ws = null
  ready = false
  pending.clear()
  setTransport({
    call(objectID: number, method: number, windowName: string, args: unknown): Promise<unknown> {
      const request: CallRequest = {
        objectID,
        method,
        windowName: windowName || currentWindowName(),
        args,
      }
      if (ready && ws && ws.readyState === WebSocket.OPEN) {
        return callViaWebSocket(request)
      }
      return callViaHTTP(request)
    },
  })
  const probe = () => {
    const url = (window as unknown as { __wailsWSURL?: string }).__wailsWSURL
    if (url) {
      connect(url)
      return
    }
    window.setTimeout(probe, 50)
  }
  probe()
}