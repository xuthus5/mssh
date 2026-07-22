import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoSave } from '@/hooks/useAutoSave'

describe('useAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('skips the initial value and saves after debounce when value changes', async () => {
    const onSave = vi.fn(async () => {})
    const { result, rerender } = renderHook(
      ({ value }) => useAutoSave({ value, onSave, delayMs: 300 }),
      { initialProps: { value: { name: 'a' } } },
    )

    expect(onSave).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')

    rerender({ value: { name: 'b' } })
    expect(result.current.status).toBe('pending')
    await act(async () => {
      vi.advanceTimersByTime(299)
    })
    expect(onSave).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
    })
    expect(onSave).toHaveBeenCalledWith({ name: 'b' })
    expect(result.current.status).toBe('saved')
  })

  it('coalesces rapid edits into a single save of the latest value', async () => {
    const onSave = vi.fn(async () => {})
    const { rerender } = renderHook(
      ({ value }) => useAutoSave({ value, onSave, delayMs: 200 }),
      { initialProps: { value: 1 } },
    )
    rerender({ value: 2 })
    rerender({ value: 3 })
    await act(async () => {
      vi.advanceTimersByTime(200)
      await Promise.resolve()
    })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(3)
  })

  it('flush saves immediately and records errors', async () => {
    const onSave = vi.fn(async () => {
      throw new Error('network')
    })
    const { result, rerender } = renderHook(
      ({ value }) => useAutoSave({ value, onSave, delayMs: 500 }),
      { initialProps: { value: 'x' } },
    )
    rerender({ value: 'y' })
    await act(async () => {
      await result.current.flush()
    })
    expect(onSave).toHaveBeenCalledWith('y')
    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('network')
  })
})
