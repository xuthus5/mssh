declare global {
  interface Window {
    wails: {
      Call: {
        ByID: (methodID: number, ...args: unknown[]) => PromiseLike<unknown> & { cancel?: () => void }
        ByName: (methodName: string, ...args: unknown[]) => PromiseLike<unknown> & { cancel?: () => void }
      }
      Events: {
        On: (event: string, callback: (...args: unknown[]) => void) => () => void
        Emit: (event: string, ...args: unknown[]) => void
        Off: (event: string) => void
      }
    }
  }
}

export function isWails(): boolean {
  return typeof window !== 'undefined' && typeof window.wails !== 'undefined'
}

export async function call(methodID: number, ...args: unknown[]): Promise<unknown> {
  if (!isWails()) {
    throw new Error('Wails runtime not available - run with wails3 dev or wails3 build')
  }
  return window.wails.Call.ByID(methodID, ...args)
}

export function onEvent(event: string, callback: (...args: unknown[]) => void): () => void {
  if (!isWails()) {
    return () => {}
  }
  return window.wails.Events.On(event, callback)
}
