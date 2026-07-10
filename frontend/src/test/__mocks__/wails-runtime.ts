const handlers = new Map<string, (...args: any[]) => Promise<any>>()
const eventCallbacks = new Map<string, Array<(event: any) => void>>()

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

export const Events = {
  On: (event: string, callback: (event: any) => void) => {
    const cbs = eventCallbacks.get(event) || []
    cbs.push(callback)
    eventCallbacks.set(event, cbs)
    return () => {
      const list = eventCallbacks.get(event) || []
      eventCallbacks.set(event, list.filter(c => c !== callback))
    }
  },
  Emit: () => {},
  Off: () => {},
}

export function __registerHandler(name: string, fn: (...args: any[]) => Promise<any>) {
  handlers.set(name, fn)
}

export function __clearHandlers() {
  handlers.clear()
  eventCallbacks.clear()
}

export function __emitEvent(name: string, data: any) {
  const cbs = eventCallbacks.get(name) || []
  for (const cb of cbs) {
    cb(data)
  }
}
