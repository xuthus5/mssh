import '@testing-library/jest-dom/vitest'

export function createWailsMock() {
  const handler = new Map<number, (...args: any[]) => Promise<any>>()

  Object.defineProperty(window, 'wails', {
    value: {
      Call: {
        ByID: async (id: number, ...args: any[]) => {
          const fn = handler.get(id)
          if (!fn) {
            throw new Error(`No mock handler for method ID ${id}`)
          }
          return fn(...args)
        },
      },
      Events: {
        On: (_event: string, _callback: (...args: any[]) => void) => {
          return () => {}
        },
        Emit: () => {},
        Off: () => {},
      },
    },
    writable: true,
    configurable: true,
  })

  return {
    onMethod: (id: number, fn: (...args: any[]) => Promise<any>) => {
      handler.set(id, fn)
    },
    clear: () => handler.clear(),
  }
}
