let _ByName: ((methodName: string, ...args: unknown[]) => Promise<unknown>) | null = null

function findByName(): typeof _ByName {
  const w = (window as any).wails
  if (!w) {
    console.log('[wails] window.wails not found, available globals:', Object.keys(window).filter(k => k.startsWith('wails') || k.startsWith('_')))
    return null
  }
  const keys = Object.keys(w)
  console.log('[wails] window.wails keys:', keys.join(', '))
  if (w.Call?.ByName) return (m: string, ...a: unknown[]) => w.Call.ByName(m, ...a)
  if (w.Call?.ByID) {
    console.log('[wails] found Call.ByID, using numeric IDs')
    // We have ByID but not ByName — still not useful without method IDs
  }
  if (w.ByName) return (m: string, ...a: unknown[]) => w.ByName(m, ...a)
  console.log('[wails] no ByName/Call.ByName found. Keys:', keys.join(', '))
  return null
}

export function isWails(): boolean {
  return typeof window !== 'undefined'
}

export async function onEvent(event: string, callback: (...args: unknown[]) => void): Promise<() => void> {
  const w = (window as any).wails
  if (w?.Events?.On) {
    return w.Events.On(event, callback)
  }
  return () => {}
}

export async function callByName(fqn: string, ...args: unknown[]): Promise<unknown> {
  const fn = _ByName ?? findByName()
  if (fn) return fn(fqn, ...args)
  const msg = `[wails] ByName not found for ${fqn} — check console for window.wails keys`
  console.error(msg)
  throw new Error(msg)
}

export function __setByName(fn: (methodName: string, ...args: unknown[]) => Promise<unknown>) {
  _ByName = fn
}
