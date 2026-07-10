let _ByName: ((methodName: string, ...args: unknown[]) => Promise<unknown>) | null = null

async function waitForRuntime(): Promise<NonNullable<typeof _ByName>> {
  // Wait for the inline loader in index.html to finish
  const w = (window as any).__wailsRuntime
  if (w) {
    if (w.Call?.ByName) return (m: string, ...a: unknown[]) => w.Call.ByName(m, ...a)
    if (w.ByName) return (m: string, ...a: unknown[]) => w.ByName(m, ...a)
  }
  // If not available yet, wait for the __wailsReady promise
  const mod = await (window as any).__wailsReady
  if (mod) {
    if (mod.Call?.ByName) return (m: string, ...a: unknown[]) => mod.Call.ByName(m, ...a)
    if (mod.ByName) return (m: string, ...a: unknown[]) => mod.ByName(m, ...a)
  }
  throw new Error('Wails runtime not available')
}

export function isWails(): boolean {
  return typeof window !== 'undefined'
}

export async function onEvent(event: string, callback: (...args: unknown[]) => void): Promise<() => void> {
  const w = (window as any).wails
  if (w?.Events?.On) {
    return w.Events.On(event, callback)
  }
  const runtime = (window as any).__wailsRuntime
  if (runtime?.Events?.On) {
    return runtime.Events.On(event, callback)
  }
  return () => {}
}

export async function callByName(fqn: string, ...args: unknown[]): Promise<unknown> {
  const fn = _ByName
  if (fn) return fn(fqn, ...args)

  _ByName = await waitForRuntime()
  return _ByName(fqn, ...args)
}

export function __setByName(fn: (methodName: string, ...args: unknown[]) => Promise<unknown>) {
  _ByName = fn
}
