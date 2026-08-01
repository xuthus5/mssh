import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Events } from '@wailsio/runtime'
import { useAutoSave } from '@/hooks/useAutoSave'
import { useToastStore } from '@/components/ui/toast'
import { SETTINGS_PREVIEW_CANCELLED_EVENT } from '@/lib/settingsWindowEvents'

describe('useAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useToastStore.setState({ toasts: [] })
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

  it('fires a success toast after a real autosave when notify is enabled', async () => {
    const onSave = vi.fn(async () => {})
    const { rerender } = renderHook(
      ({ value }) => useAutoSave({ value, onSave, delayMs: 300, notify: true }),
      { initialProps: { value: { name: 'a' } } },
    )
    rerender({ value: { name: 'b' } })
    await act(async () => {
      vi.advanceTimersByTime(301)
      await Promise.resolve()
    })
    expect(useToastStore.getState().toasts.some((item) => item.type === 'success' && item.message === '已自动保存')).toBe(true)
  })

  it('fires an error toast when a notified autosave fails', async () => {
    const onSave = vi.fn(async () => { throw new Error('disk full') })
    const { rerender } = renderHook(
      ({ value }) => useAutoSave({ value, onSave, delayMs: 300, notify: true }),
      { initialProps: { value: { name: 'a' } } },
    )
    rerender({ value: { name: 'b' } })
    await act(async () => {
      vi.advanceTimersByTime(301)
      await Promise.resolve()
    })
    expect(useToastStore.getState().toasts.some((item) => item.type === 'error' && item.message.includes('自动保存失败: disk full'))).toBe(true)
  })

  it('keeps autosave silent when notify is disabled', async () => {
    const onSave = vi.fn(async () => {})
    const { rerender } = renderHook(
      ({ value }) => useAutoSave({ value, onSave, delayMs: 300 }),
      { initialProps: { value: { name: 'a' } } },
    )
    rerender({ value: { name: 'b' } })
    await act(async () => {
      vi.advanceTimersByTime(301)
      await Promise.resolve()
    })
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('coalesces rapid edits into a single save of the latest value', async () => {
    const onSave = vi.fn(async () => {})
    const { rerender } = renderHook(
      ({ value }) => useAutoSave({ value, onSave, delayMs: 200 }),
      { initialProps: { value: 1 } },
    )
    rerender({ value: 2 })
    expect(onSave).not.toHaveBeenCalled()
    rerender({ value: 3 })
    expect(onSave).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(199)
      await Promise.resolve()
    })
    expect(onSave).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(1)
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

  it('clears a stale save error when the value returns to the saved baseline', async () => {
    const onSave = vi.fn(async () => {
      throw new Error('network')
    })
    const { result, rerender } = renderHook(
      ({ value }) => useAutoSave({ value, onSave, delayMs: 500 }),
      { initialProps: { value: 'saved' } },
    )

    rerender({ value: 'failed' })
    await act(async () => { await result.current.flush() })
    expect(result.current.status).toBe('error')

    rerender({ value: 'saved' })

    expect(result.current.error).toBeNull()
    expect(result.current.status).toBe('saved')
  })

  it('ignores an obsolete in-flight failure after returning to the saved baseline', async () => {
    const firstSave = deferred<void>()
    const onSave = vi.fn()
      .mockImplementationOnce(async () => firstSave.promise)
      .mockImplementationOnce(async () => {})
    const { result, rerender } = renderHook(
      ({ value }) => useAutoSave({ value, onSave, delayMs: 500 }),
      { initialProps: { value: 'saved' } },
    )

    rerender({ value: 'changed' })
    let flushPromise!: Promise<void>
    act(() => { flushPromise = result.current.flush() })
    expect(onSave).toHaveBeenCalledWith('changed')
    expect(result.current.status).toBe('saving')

    rerender({ value: 'saved' })
    expect(result.current.error).toBeNull()

    await act(async () => {
      firstSave.reject(new Error('network'))
      await flushPromise
      await Promise.resolve()
    })

    expect(onSave).toHaveBeenCalledTimes(2)
    expect(result.current.error).toBeNull()
    expect(result.current.status).toBe('saved')
  })

  it('persists a reverted baseline after an obsolete in-flight save succeeds', async () => {
    const firstSave = deferred<void>()
    const secondSave = deferred<void>()
    const onSave = vi.fn()
      .mockImplementationOnce(async () => firstSave.promise)
      .mockImplementationOnce(async () => secondSave.promise)
    const { result, rerender } = renderHook(
      ({ value }) => useAutoSave({ value, onSave, delayMs: 500 }),
      { initialProps: { value: 'saved' } },
    )

    rerender({ value: 'changed' })
    let flushPromise!: Promise<void>
    act(() => { flushPromise = result.current.flush() })
    expect(onSave).toHaveBeenCalledWith('changed')

    rerender({ value: 'saved' })
    expect(result.current.status).toBe('saving')
    let flushSettled = false
    void flushPromise.then(() => { flushSettled = true })
    await act(async () => {
      firstSave.resolve()
      await Promise.resolve()
    })

    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave).toHaveBeenLastCalledWith('saved')
    expect(flushSettled).toBe(false)
    expect(result.current.status).toBe('saving')
    await act(async () => {
      secondSave.resolve()
      await flushPromise
    })
    expect(flushSettled).toBe(true)
    expect(result.current.status).toBe('saved')
  })

  it('coalesces an in-flight edit into the latest non-baseline value', async () => {
    const firstSave = deferred<void>()
    const secondSave = deferred<void>()
    const onSave = vi.fn()
      .mockImplementationOnce(async () => firstSave.promise)
      .mockImplementationOnce(async () => secondSave.promise)
    const { result, rerender } = renderHook(
      ({ value }) => useAutoSave({ value, onSave, delayMs: 500 }),
      { initialProps: { value: 'saved' } },
    )

    rerender({ value: 'first' })
    let flushPromise!: Promise<void>
    act(() => { flushPromise = result.current.flush() })
    rerender({ value: 'intermediate' })
    rerender({ value: 'latest' })

    await act(async () => {
      firstSave.resolve()
      await Promise.resolve()
    })

    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave).toHaveBeenLastCalledWith('latest')
    expect(result.current.status).toBe('saving')
    await act(async () => {
      secondSave.resolve()
      await flushPromise
    })
    expect(result.current.status).toBe('saved')
  })

  it('reports the final correction failure after an obsolete save succeeds', async () => {
    const firstSave = deferred<void>()
    const onSave = vi.fn()
      .mockImplementationOnce(async () => firstSave.promise)
      .mockImplementationOnce(async () => { throw new Error('correction failed') })
    const { result, rerender } = renderHook(
      ({ value }) => useAutoSave({ value, onSave, delayMs: 500 }),
      { initialProps: { value: 'saved' } },
    )

    rerender({ value: 'changed' })
    let flushPromise!: Promise<void>
    act(() => { flushPromise = result.current.flush() })
    rerender({ value: 'saved' })
    await act(async () => {
      firstSave.resolve()
      await flushPromise
    })

    expect(onSave).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('correction failed')
  })

  it('drops an obsolete queued edit when the value returns to the active snapshot', async () => {
    const firstSave = deferred<void>()
    const onSave = vi.fn(async () => firstSave.promise)
    const { result, rerender } = renderHook(
      ({ value }) => useAutoSave({ value, onSave, delayMs: 500 }),
      { initialProps: { value: 'saved' } },
    )

    rerender({ value: 'active' })
    let flushPromise!: Promise<void>
    act(() => { flushPromise = result.current.flush() })
    rerender({ value: 'obsolete' })
    rerender({ value: 'active' })

    await act(async () => {
      firstSave.resolve()
      await flushPromise
    })

    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave).toHaveBeenCalledWith('active')
    expect(result.current.status).toBe('saved')
  })

  it('cancels a queued edit while auto-save is disabled and saves it after re-enable', async () => {
    const firstSave = deferred<void>()
    const onSave = vi.fn()
      .mockImplementationOnce(async () => firstSave.promise)
      .mockImplementationOnce(async () => {})
    const { result, rerender } = renderHook(
      ({ value, enabled }) => useAutoSave({ value, onSave, enabled, delayMs: 100 }),
      { initialProps: { value: 'saved', enabled: true } },
    )

    rerender({ value: 'active', enabled: true })
    let flushPromise!: Promise<void>
    act(() => { flushPromise = result.current.flush() })
    rerender({ value: 'queued', enabled: true })
    rerender({ value: 'queued', enabled: false })
    await act(async () => {
      firstSave.resolve()
      await flushPromise
    })
    expect(onSave).toHaveBeenCalledOnce()

    rerender({ value: 'queued', enabled: true })
    await act(async () => {
      vi.advanceTimersByTime(100)
      await Promise.resolve()
    })
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave).toHaveBeenLastCalledWith('queued')
    expect(result.current.status).toBe('saved')
  })

  it('does not save while isReady is false, then arms baseline when ready', async () => {
    const onSave = vi.fn(async () => {})
    const { result, rerender } = renderHook(
      ({ value, isReady }) => useAutoSave({ value, onSave, isReady, delayMs: 100 }),
      { initialProps: { value: { name: 'defaults' }, isReady: false } },
    )
    rerender({ value: { name: 'edited-before-ready' }, isReady: false })
    await act(async () => {
      vi.advanceTimersByTime(200)
      await Promise.resolve()
    })
    expect(onSave).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')

    rerender({ value: { name: 'loaded' }, isReady: true })
    await act(async () => {
      vi.advanceTimersByTime(200)
      await Promise.resolve()
    })
    expect(onSave).not.toHaveBeenCalled()

    rerender({ value: { name: 'user-edit' }, isReady: true })
    await act(async () => {
      vi.advanceTimersByTime(100)
      await Promise.resolve()
    })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith({ name: 'user-edit' })
  })

  it('flushes a pending edit when the owner unmounts', async () => {
    const onSave = vi.fn(async () => {})
    const { rerender, unmount } = renderHook(
      ({ value }) => useAutoSave({ value, onSave, delayMs: 500 }),
      { initialProps: { value: 'initial' } },
    )

    rerender({ value: 'pending' })
    await act(async () => {
      unmount()
      await Promise.resolve()
    })

    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave).toHaveBeenCalledWith('pending')
  })

  it('starts a pending save synchronously when the page is hidden', async () => {
    const save = deferred<void>()
    const onSave = vi.fn(() => save.promise)
    const { result, rerender } = renderHook(
      ({ value }) => useAutoSave({ value, onSave, delayMs: 500 }),
      { initialProps: { value: 'initial' } },
    )

    rerender({ value: 'pending' })
    act(() => window.dispatchEvent(new Event('pagehide')))

    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave).toHaveBeenCalledWith('pending')
    expect(result.current.status).toBe('saving')
    await act(async () => {
      save.resolve()
      await save.promise
    })
    expect(result.current.status).toBe('saved')
  })

  it('starts a pending save when the native settings window hides', async () => {
    const save = deferred<void>()
    const onSave = vi.fn(() => save.promise)
    const { result, rerender } = renderHook(
      ({ value }) => useAutoSave({ value, onSave, delayMs: 500 }),
      { initialProps: { value: 'initial' } },
    )

    rerender({ value: 'pending' })
    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })

    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave).toHaveBeenCalledWith('pending')
    expect(result.current.status).toBe('saving')
    await act(async () => {
      save.resolve()
      await save.promise
    })
    expect(result.current.status).toBe('saved')
  })

  it('aliases an active sensitive save to its redacted draft without a second write', async () => {
    const save = deferred<void>()
    const onSave = vi.fn(() => save.promise)
    const initial = { name: 'provider', secret: '' }
    const sensitive = { name: 'provider', secret: 'token' }
    const redacted = { name: 'provider', secret: '' }
    const { result, rerender } = renderHook(
      ({ value }) => useAutoSave({ value, onSave, delayMs: 500 }),
      { initialProps: { value: initial } },
    )

    rerender({ value: sensitive })
    act(() => { void result.current.flush() })
    act(() => {
      result.current.redact(sensitive, redacted)
      rerender({ value: redacted })
    })
    await act(async () => { save.resolve(); await save.promise; await Promise.resolve() })

    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave).toHaveBeenCalledWith(sensitive)
    expect(result.current.status).toBe('saved')
    await act(async () => { await result.current.flush() })
    expect(onSave).toHaveBeenCalledOnce()
  })

  it('aliases the newest queued sensitive save while preserving its original payload', async () => {
    const firstSave = deferred<void>()
    const secondSave = deferred<void>()
    const onSave = vi.fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise)
    const first = { name: 'first', secret: '' }
    const latest = { name: 'latest', secret: 'token' }
    const redacted = { name: 'latest', secret: '' }
    const { result, rerender } = renderHook(
      ({ value }) => useAutoSave({ value, onSave, delayMs: 500 }),
      { initialProps: { value: { name: 'initial', secret: '' } } },
    )

    rerender({ value: first })
    act(() => { void result.current.flush() })
    rerender({ value: latest })
    act(() => { void result.current.flush() })
    act(() => {
      result.current.redact(latest, redacted)
      rerender({ value: redacted })
    })
    await act(async () => { firstSave.resolve(); await firstSave.promise; await Promise.resolve() })
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave).toHaveBeenLastCalledWith(latest)
    await act(async () => { secondSave.resolve(); await secondSave.promise; await Promise.resolve() })

    expect(onSave).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('saved')
  })

  it('keeps a redacted draft unsaved when the sensitive save fails', async () => {
    const firstSave = deferred<void>()
    const onSave = vi.fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockResolvedValueOnce(undefined)
    const sensitive = { name: 'provider', secret: 'token' }
    const redacted = { name: 'provider', secret: '' }
    const { result, rerender } = renderHook(
      ({ value }) => useAutoSave({ value, onSave, delayMs: 500 }),
      { initialProps: { value: { name: 'initial', secret: '' } } },
    )

    rerender({ value: sensitive })
    let firstFlush!: Promise<void>
    act(() => { firstFlush = result.current.flush() })
    act(() => {
      result.current.redact(sensitive, redacted)
      rerender({ value: redacted })
    })
    await act(async () => {
      firstSave.reject(new Error('save failed'))
      await firstFlush
      await Promise.resolve()
    })
    expect(result.current.status).toBe('error')

    await act(async () => { await result.current.flush() })
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave).toHaveBeenLastCalledWith(redacted)
    expect(result.current.status).toBe('saved')
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
