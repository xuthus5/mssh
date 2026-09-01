import { clientId, setTransport } from '@wailsio/runtime'

interface WsPending { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }
interface CallRequest { type: 'call'; objectID: number; method: number; windowName: string; args: unknown }
interface TerminalInputRequest { type: 'terminal_input'; terminalID: string; data: string }
type IPCRequest = CallRequest | TerminalInputRequest
interface QueuedCall { request: IPCRequest; resolve: (value: unknown) => void; reject: (reason?: unknown) => void; timer: number }
interface WsMessage { id?: string; ok?: boolean; type?: 'response' | 'text' | 'json' | 'event'; data?: string; error?: string; event?: unknown }

const IPC_CALL_TIMEOUT_MS = 15_000
const IPC_MAX_QUEUED_CALLS = 512
const IPC_RECONNECT_MIN_DELAY_MS = 50
const IPC_RECONNECT_MAX_DELAY_MS = 2_000
export const IPC_RECONNECTED_EVENT = 'mssh:ipc-reconnected'

let ws: WebSocket | null = null
let ready = false
let transportURL: string | null = null
let reconnectTimer: number | null = null
let reconnectAttempt = 0
let probeTimer: number | null = null
let connectionGeneration = 0
let connectionEstablished = false
let transportInstalled = false
const pending = new Map<string, WsPending>()
const queued: QueuedCall[] = []

function dispatchEvent(message: WsMessage): void {
  const wails = (window as unknown as { _wails?: { dispatchWailsEvent?: (event: unknown) => void } })._wails
  wails?.dispatchWailsEvent?.(message.event)
}

function handleMessage(message: WsMessage): void {
  if (message && typeof message.id === 'string') {
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    if (!message.ok) { waiter.reject(new Error(message.error || 'wails runtime call failed')); return }
    if (message.type === 'json' && typeof message.data === 'string') {
      try { waiter.resolve(JSON.parse(message.data)) } catch (error) { waiter.reject(error) }
      return
    }
    waiter.resolve(message.data)
    return
  }
  if (message?.type === 'event') dispatchEvent(message)
}

function currentWindowName(): string {
  return new URLSearchParams(window.location.search).get('window') === 'settings' ? 'settings' : 'main'
}

function rejectPending(reason: Error): void {
  for (const waiter of pending.values()) waiter.reject(reason)
  pending.clear()
}

function nextReconnectDelay(): number {
  const delay = Math.min(IPC_RECONNECT_MAX_DELAY_MS, IPC_RECONNECT_MIN_DELAY_MS * (2 ** reconnectAttempt))
  reconnectAttempt += 1
  return delay
}

function sendViaWebSocket(call: IPCRequest, resolve: (value: unknown) => void, reject: (reason?: unknown) => void): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) { reject(new Error('mssh IPC is not connected')); return }
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  pending.set(id, { resolve, reject })
  try {
    ws.send(JSON.stringify(call.type === 'call'
      ? { type: 'call', id, object: call.objectID, method: call.method, args: call.args ?? null, windowName: call.windowName, clientId }
      : { type: 'terminal_input', id, terminalID: call.terminalID, data: call.data }))
  } catch (error) { pending.delete(id); reject(error) }
}

function flushQueued(): void {
  if (!ready || !ws) return
  while (queued.length > 0) {
    const call = queued.shift()
    if (!call) return
    window.clearTimeout(call.timer)
    sendViaWebSocket(call.request, call.resolve, call.reject)
  }
}

function connect(url: string, generation = connectionGeneration): void {
  if (generation !== connectionGeneration || (ws && ws.readyState !== WebSocket.CLOSED)) return
  const socket = new WebSocket(url)
  ws = socket
  socket.onmessage = (event) => {
    try { handleMessage(JSON.parse(event.data as string) as WsMessage) } catch { /* Ignore malformed frames. */ }
  }
  socket.onopen = () => {
    if (generation !== connectionGeneration) return
    const reconnecting = connectionEstablished
    connectionEstablished = true
    ready = true
    reconnectAttempt = 0
    flushQueued()
    if (reconnecting) window.dispatchEvent(new Event(IPC_RECONNECTED_EVENT))
  }
  socket.onclose = () => {
    if (generation !== connectionGeneration || ws !== socket) return
    ready = false
    ws = null
    rejectPending(new Error('mssh IPC disconnected'))
    if (transportURL && typeof window !== 'undefined') {
      reconnectTimer = window.setTimeout(() => { reconnectTimer = null; if (transportURL) connect(transportURL, generation) }, nextReconnectDelay())
    }
  }
  socket.onerror = () => { /* onclose owns cleanup and reconnect scheduling. */ }
}

function callViaIPC(call: IPCRequest): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    if (ready && ws?.readyState === WebSocket.OPEN) { sendViaWebSocket(call, resolve, reject); return }
    if (queued.length >= IPC_MAX_QUEUED_CALLS) {
      reject(new Error('mssh IPC queue is full'))
      return
    }
    const timer = window.setTimeout(() => {
      const index = queued.findIndex((item) => item.resolve === resolve)
      if (index >= 0) queued.splice(index, 1)
      reject(new Error('mssh IPC connection timeout'))
    }, IPC_CALL_TIMEOUT_MS)
    queued.push({ request: call, resolve, reject, timer })
    if (transportURL) connect(transportURL)
  })
}

function startProbe(): void {
  if (probeTimer !== null) return
  const probe = () => {
    probeTimer = null
    if (typeof window === 'undefined') return
    const url = (window as unknown as { __wailsWSURL?: string }).__wailsWSURL
    if (url) { transportURL = url; connect(url); return }
    probeTimer = window.setTimeout(probe, 50)
  }
  probe()
}

/** Loads the backend-provided script that publishes the authenticated IPC URL. */
export async function loadWailsTransport(): Promise<void> {
  try {
    const response = await fetch('/wails/transport.js')
    if (!response.ok) return
    const script = document.createElement('script')
    script.textContent = await response.text()
    document.head.appendChild(script)
  } catch { /* The probe continues so transient asset failures can recover. */ }
}

/** Installs the single IPC transport used by all Wails calls and events. */
export function initIPCTransport(): void {
  connectionGeneration += 1
  ws?.close()
  ws = null
  ready = false
  transportURL = null
  connectionEstablished = false
  transportInstalled = true
  reconnectAttempt = 0
  if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
  reconnectTimer = null
  if (probeTimer !== null) window.clearTimeout(probeTimer)
  probeTimer = null
  rejectPending(new Error('mssh IPC transport reset'))
  for (const call of queued.splice(0)) { window.clearTimeout(call.timer); call.reject(new Error('mssh IPC transport reset')) }
  setTransport({ call(objectID: number, method: number, windowName: string, args: unknown): Promise<unknown> {
      return callViaIPC({ type: 'call', objectID, method, windowName: windowName || currentWindowName(), args })
  } })
  startProbe()
}

/** @deprecated Use initIPCTransport; retained for callers during migration. */
export const initWsTransport = initIPCTransport

/** Reports whether the unified transport has been installed by the app entrypoint. */
export function isIPCTransportInstalled(): boolean {
  return transportInstalled
}

/** Sends interactive terminal input through the transport fast path. */
export function sendTerminalInput(terminalID: string, data: string): Promise<number> {
  return callViaIPC({ type: 'terminal_input', terminalID, data }).then((value) => {
    if (typeof value !== 'number') throw new Error('invalid terminal input acknowledgement')
    return value
  })
}
