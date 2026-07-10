import '@testing-library/jest-dom/vitest'
import { __setByName } from '@/lib/wails/runtime'

export function createWailsMock() {
  const handler = new Map<string, (...args: any[]) => Promise<any>>()

  __setByName(async (fqn: string, ...args: any[]) => {
    const fn = handler.get(fqn)
    if (!fn) {
      console.error(`[mock] no handler for: ${fqn}`)
      throw new Error(`No mock handler for method ${fqn}`)
    }
    return fn(...args)
  })

  return {
    onMethod: (key: string, fn: (...args: any[]) => Promise<any>) => {
      handler.set(key, fn)
    },
    clear: () => handler.clear(),
  }
}
