import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initWsTransport, loadWailsTransport, sendTerminalInput, IPC_RECONNECTED_EVENT } from '@/lib/wsTransport'

const { mockSetTransport, mockDispatchEvent } = vi.hoisted(() => ({
  mockSetTransport: vi.fn(),
  mockDispatchEvent: vi.fn(),
}))
vi.mock('@wailsio/runtime', () => ({ setTransport: mockSetTransport, clientId: 'test-client-id' }))

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static readonly OPEN = 1
  static readonly CLOSED = 3

  url: string
  readyState = 0
  onmessage: ((event: { data: string }) => void) | null = null
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  sent: string[] = []

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  receive(data: string): void {
    this.onmessage?.({ data })
  }
}

type WsTransport = {
  call: (objectID: number, method: number, windowName: string, args: unknown) => Promise<unknown>
}

const mockFetch = vi.fn()

async function flushProbe(): Promise<void> {
  await vi.advanceTimersByTimeAsync(60)
}

function setWSURL(): void {
  ;(window as unknown as { __wailsWSURL: string }).__wailsWSURL = 'ws://127.0.0.1:1/wails/ws'
}

function connectWS(): MockWebSocket {
  setWSURL()
  initWsTransport()
  const ws = MockWebSocket.instances[0]
  expect(ws).toBeDefined()
  return ws
}

async function openAndGetTransport(): Promise<{ transport: WsTransport, ws: MockWebSocket }> {
  const ws = connectWS()
  await flushProbe()
  ws.open()
  const transport = mockSetTransport.mock.calls[0][0] as WsTransport
  return { transport, ws }
}

beforeEach(() => {
  vi.useFakeTimers()
  mockSetTransport.mockClear()
  mockDispatchEvent.mockReset()
  mockFetch.mockReset()
  MockWebSocket.instances = []
  delete (window as unknown as { __wailsWSURL?: string }).__wailsWSURL
  delete (window as unknown as { _wails?: unknown })._wails
  ;(globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket
  ;(globalThis as unknown as { fetch: typeof mockFetch }).fetch = mockFetch
})

afterEach(() => {
  vi.useRealTimers()
})

describe('wsTransport', () => {
  it('queues calls until the single IPC socket is connected', async () => {
    initWsTransport()
    const transport = mockSetTransport.mock.calls[0][0] as WsTransport
    setWSURL()
    const result = transport.call(1, 2, '', null)
    await flushProbe()
    const ws = MockWebSocket.instances[0]
    expect(ws.sent).toHaveLength(0)
    ws.open()
    await vi.advanceTimersByTimeAsync(0)
    expect(ws.sent).toHaveLength(1)
    const sent = JSON.parse(ws.sent[0])
    expect(sent.type).toBe('call')
    ws.receive(JSON.stringify({ id: sent.id, ok: true, type: 'text', data: 'hello' }))
    await expect(result).resolves.toBe('hello')
  })

  it('uses WebSocket once it is open', async () => {
    const { transport, ws } = await openAndGetTransport()
    const result = transport.call(1, 2, '', null)
    await vi.advanceTimersByTimeAsync(0)

    expect(ws.sent).toHaveLength(1)
    expect(mockFetch).not.toHaveBeenCalled()
    const sent = JSON.parse(ws.sent[0])
    expect(sent.windowName).toBe('main')

    ws.receive(JSON.stringify({ id: sent.id, ok: true, type: 'text', data: 'ok' }))
    await expect(result).resolves.toBe('ok')
  })

  it('notifies terminal owners after a reconnect', async () => {
    const listener = vi.fn()
    window.addEventListener(IPC_RECONNECTED_EVENT, listener)
    const { ws } = await openAndGetTransport()
    ws.close()
    await vi.advanceTimersByTimeAsync(50)
    const reconnect = MockWebSocket.instances[1]
    reconnect.open()
    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener(IPC_RECONNECTED_EVENT, listener)
  })

  it('uses the unified terminal input frame on the same IPC socket', async () => {
    const { ws } = await openAndGetTransport()
    const result = sendTerminalInput('term-1', 'echo hi')
    await vi.advanceTimersByTimeAsync(0)
    const sent = JSON.parse(ws.sent[0])
    expect(sent).toMatchObject({ type: 'terminal_input', terminalID: 'term-1', data: 'echo hi' })
    ws.receive(JSON.stringify({ id: sent.id, ok: true, type: 'json', data: '7' }))
    await expect(result).resolves.toBe(7)
  })

  it('parses JSON responses over WebSocket', async () => {
    const { transport, ws } = await openAndGetTransport()
    const result = transport.call(1, 2, '', null)
    await vi.advanceTimersByTimeAsync(0)
    const sent = JSON.parse(ws.sent[0])
    ws.receive(JSON.stringify({ id: sent.id, ok: true, type: 'json', data: '{"count":7}' }))
    await expect(result).resolves.toEqual({ count: 7 })
  })

  it('rejects a failed WebSocket call with the backend error', async () => {
    const { transport, ws } = await openAndGetTransport()
    const result = transport.call(1, 2, '', null)
    await vi.advanceTimersByTimeAsync(0)
    const sent = JSON.parse(ws.sent[0])
    ws.receive(JSON.stringify({ id: sent.id, ok: false, error: 'boom' }))
    await expect(result).rejects.toThrow('boom')
  })

  it('dispatches backend events through window._wails', async () => {
    ;(window as unknown as { _wails: { dispatchWailsEvent: typeof mockDispatchEvent } })._wails = {
      dispatchWailsEvent: mockDispatchEvent,
    }
    const { ws } = await openAndGetTransport()
    ws.receive(JSON.stringify({ type: 'event', event: { name: 'terminal:output', data: { x: 1 } } }))
    expect(mockDispatchEvent).toHaveBeenCalledWith({ name: 'terminal:output', data: { x: 1 } })
  })

  it('rejects in-flight calls after the socket disconnects and reconnects', async () => {
    const { transport, ws } = await openAndGetTransport()
    const result = transport.call(1, 2, '', null)
    ws.close()
    await expect(result).rejects.toThrow('mssh IPC disconnected')
    await vi.advanceTimersByTimeAsync(50)
    expect(MockWebSocket.instances).toHaveLength(2)
  })

  it('loads the transport.js script to inject the WS url', async () => {
    const scripts: HTMLScriptElement[] = []
    vi.spyOn(document.head, 'appendChild').mockImplementation((node: Node) => {
      scripts.push(node as HTMLScriptElement)
      return node
    })
    mockFetch.mockResolvedValue(new Response('window.__wailsWSURL = "ws://127.0.0.1:9/wails/ws";', {
      headers: { 'Content-Type': 'application/javascript' },
    }))
    await loadWailsTransport()
    expect(scripts).toHaveLength(1)
    // jsdom does not execute inline scripts; run it to verify the payload.
    new Function(scripts[0].textContent || '')()
    expect((window as unknown as { __wailsWSURL?: string }).__wailsWSURL).toBe('ws://127.0.0.1:9/wails/ws')
  })

  it('loadWailsTransport tolerates a missing script', async () => {
    mockFetch.mockResolvedValue(new Response('not found', { status: 404 }))
    await expect(loadWailsTransport()).resolves.toBeUndefined()
    expect((window as unknown as { __wailsWSURL?: string }).__wailsWSURL).toBeUndefined()
  })

  it('connects once the backend injects the url', async () => {
    initWsTransport()
    expect(MockWebSocket.instances).toHaveLength(0)
    setWSURL()
    await flushProbe()
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(MockWebSocket.instances[0].url).toBe('ws://127.0.0.1:1/wails/ws')
  })

  it('passes through an explicit window name', async () => {
    const { transport, ws } = await openAndGetTransport()
    transport.call(1, 2, 'settings', null)
    await vi.advanceTimersByTimeAsync(0)
    const sent = JSON.parse(ws.sent[0])
    expect(sent.windowName).toBe('settings')
  })
})
