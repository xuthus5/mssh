import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSidebarMacros } from '@/hooks/useSidebarState'

const macroService = vi.hoisted(() => ({
  List: vi.fn(),
  Create: vi.fn(),
  Delete: vi.fn(),
}))

vi.mock('@/lib/wails', () => ({ MacroService: macroService }))
vi.mock('@/lib/executeMacro', () => ({ executeMacroOnActiveTerminal: vi.fn(async () => undefined) }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

const macro = (id: number, name: string) => ({ id, name, shortcut: '', command: name.toLowerCase() })

describe('useSidebarMacros', () => {
  beforeEach(() => {
    macroService.List.mockReset().mockResolvedValue([])
    macroService.Create.mockReset()
    macroService.Delete.mockReset().mockResolvedValue(undefined)
  })

  it('keeps the latest list result when reloads finish out of order', async () => {
    const first = deferred<ReturnType<typeof macro>[]>()
    const second = deferred<ReturnType<typeof macro>[]>()
    macroService.List.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result } = renderHook(() => useSidebarMacros())
    await waitFor(() => expect(macroService.List).toHaveBeenCalledOnce())

    let reload!: Promise<void>
    act(() => { reload = result.current.reload() })
    await act(async () => { second.resolve([macro(2, 'New')]); await reload })
    expect(result.current.macros.map((item) => item.name)).toEqual(['New'])
    await act(async () => { first.resolve([macro(1, 'Old')]); await first.promise })
    expect(result.current.macros.map((item) => item.name)).toEqual(['New'])
  })

  it('does not let an old list replace a macro created while loading', async () => {
    const list = deferred<ReturnType<typeof macro>[]>()
    macroService.List.mockReturnValueOnce(list.promise)
    macroService.Create.mockResolvedValueOnce(macro(3, 'Created'))
    const { result } = renderHook(() => useSidebarMacros())
    await waitFor(() => expect(macroService.List).toHaveBeenCalledOnce())

    await act(async () => {
      await result.current.add({ name: 'Created', shortcut: '', command: 'created' })
    })
    expect(result.current.macros.map((item) => item.name)).toEqual(['Created'])
    await act(async () => { list.resolve([macro(1, 'Old')]); await list.promise })
    expect(result.current.macros.map((item) => item.name)).toEqual(['Created'])
  })
})
