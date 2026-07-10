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

function waitForWails(timeoutMs = 5000): Promise<void> {
  if (isWails()) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const check = () => {
      if (isWails()) {
        resolve()
        return
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('Wails runtime did not load within ' + timeoutMs + 'ms'))
        return
      }
      setTimeout(check, 50)
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
