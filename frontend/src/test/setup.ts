import '@testing-library/jest-dom/vitest'

export function createWailsMock() {
  const handler = new Map<string, (...args: any[]) => Promise<any>>()

  Object.defineProperty(window, 'wails', {
    value: {
      Call: {
        ByID: async (id: number, ...args: any[]) => {
          const fn = handler.get(String(id))
          if (!fn) {
            throw new Error(`No mock handler for method ID ${id}`)
          }
          return fn(...args)
        },
        ByName: async (name: string, ...args: any[]) => {
          const fn = handler.get(name)
          if (!fn) {
            throw new Error(`No mock handler for method ${name}`)
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
    onMethod: (key: string, fn: (...args: any[]) => Promise<any>) => {
      handler.set(key, fn)
    },
    clear: () => handler.clear(),
  }
}
