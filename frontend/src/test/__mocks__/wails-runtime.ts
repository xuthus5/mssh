const handlers = new Map<string, (...args: any[]) => Promise<any>>()

export const Call = {
  ByName: async (name: string, ...args: any[]) => {
    const fn = handlers.get(name)
    if (!fn) throw new Error(`No mock handler for: ${name}`)
    return fn(...args)
  },
  ByID: async (id: number, ...args: any[]) => {
    const fn = handlers.get('id:' + id)
    if (!fn) throw new Error(`No mock handler for ID: ${id}`)
    return fn(...args)
  },
}

export const Events = { On: () => () => {}, Emit: () => {}, Off: () => {} }

export function __registerHandler(name: string, fn: (...args: any[]) => Promise<any>) {
  handlers.set(name, fn)
}

export function __clearHandlers() {
  handlers.clear()
}
