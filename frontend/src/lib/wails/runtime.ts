declare global {
  interface Window {
    wails?: {
      Call?: {
        ByID: (methodID: number, ...args: unknown[]) => PromiseLike<unknown>
        ByName: (methodName: string, ...args: unknown[]) => PromiseLike<unknown>
      }
      Events?: {
        On: (event: string, callback: (...args: unknown[]) => void) => () => void
        Emit: (event: string, ...args: unknown[]) => void
        Off: (event: string) => void
      }
    }
  }
}

export function isWails(): boolean {
  return typeof window !== 'undefined'
    && typeof window.wails !== 'undefined'
    && typeof window.wails.Call !== 'undefined'
    && typeof window.wails.Call.ByName === 'function'
}

function waitForWails(timeoutMs = 10000): Promise<void> {
  if (isWails()) {
    console.log('[wails] runtime already available')
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const start = Date.now()
    console.log('[wails] waiting for runtime...')
    const check = () => {
      if (isWails()) {
        console.log('[wails] runtime ready after', Date.now() - start, 'ms')
        resolve()
        return
      }
      if (Date.now() - start > timeoutMs) {
        const hasWails = typeof window !== 'undefined' && !!window.wails
        const hasCall = hasWails && !!window.wails!.Call
        console.error('[wails] timeout after', timeoutMs, 'ms',
          'window.wails:', typeof window.wails,
          'Call:', typeof window.wails?.Call,
          'ByName:', typeof window.wails?.Call?.ByName)
        reject(new Error('Wails runtime did not load within ' + timeoutMs + 'ms'))
        return
      }
      setTimeout(check, 100)
    }
    check()
  })
}

export async function call(methodID: number, ...args: unknown[]): Promise<unknown> {
  await waitForWails()
  return window.wails!.Call!.ByID(methodID, ...args)
}

export function onEvent(event: string, callback: (...args: unknown[]) => void): () => void {
  if (!isWails()) {
    return () => {}
  }
  return window.wails!.Events!.On(event, callback)
}

export { waitForWails }
