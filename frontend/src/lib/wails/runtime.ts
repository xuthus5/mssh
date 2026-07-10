declare global {
  interface Window {
    wails: {
      Call: {
        ByID: (id: number, ...args: unknown[]) => Promise<unknown>
      }
      Events: {
        On: (event: string, callback: (...args: unknown[]) => void) => () => void
        Emit: (event: string, ...args: unknown[]) => void
        Off: (event: string) => void
      }
    }
  }
}

const WailsError = 'Wails runtime not available - please run with wails3 dev or wails3 build'

export function isWails(): boolean {
  return typeof window !== 'undefined' && !!window.wails
}

export function requireWails(): void {
  if (!isWails()) {
    throw new Error(WailsError)
  }
}

export async function call(methodID: number, ...args: unknown[]): Promise<unknown> {
  requireWails()
  return window.wails.Call.ByID(methodID, ...args)
}

export function onEvent(event: string, callback: (...args: unknown[]) => void): () => void {
  if (!isWails()) {
    return () => {}
  }
  return window.wails.Events.On(event, callback)
}
