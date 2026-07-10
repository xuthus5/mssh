const handlers = new Map<string, (...args: any[]) => Promise<any>>()

export const Call = {
  ByName: async (name: string, ...args: any[]) => {
    const fn = handlers.get(name)
    if (!fn) {
      throw new Error(`No mock handler registered for: ${name}`)
    }
    return fn(...args)
  },
  ByID: async (id: number, ...args: any[]) => {
    const fn = handlers.get(`id:${id}`)
    if (!fn) {
      throw new Error(`No mock handler registered for ID: ${id}`)
    }
    return fn(...args)
  },
}

export const Events = {
  On: () => () => {},
  Emit: () => {},
  Off: () => {},
}

export const Create = {
  Array: (fn: (src: any) => any) => (src: any) => {
    if (!src) return []
    return src.map(fn)
  },
  Nullable: (fn: (src: any) => any) => (src: any) => {
    if (src === null || src === undefined) return null
    return fn(src)
  },
  ByteSlice: (src: any) => src,
}

export function __registerHandler(name: string, fn: (...args: any[]) => Promise<any>) {
  handlers.set(name, fn)
}

export function __clearHandlers() {
  handlers.clear()
}
