import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDraftSync } from '@/hooks/useDraftSync'
import { useAutoSave } from '@/hooks/useAutoSave'

interface Draft {
  value: string
}

const createDraft = (source: Draft) => ({ ...source })

describe('useDraftSync', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('updates a clean draft when the external source changes', () => {
    const { result, rerender } = renderHook(
      ({ source }) => useDraftSync({ source, createDraft }),
      { initialProps: { source: { value: 'initial' } } },
    )

    rerender({ source: { value: 'external' } })

    expect(result.current.draft).toEqual({ value: 'external' })
  })

  it('does not replace a newer edit with a deferred save response', () => {
    const { result, rerender } = renderHook(
      ({ source }) => useDraftSync({ source, createDraft }),
      { initialProps: { source: { value: 'initial' } } },
    )

    act(() => result.current.setDraft({ value: 'saving' }))
    const saving = result.current.draft
    act(() => result.current.setDraft({ value: 'newer' }))
    act(() => result.current.acknowledgeSaved(saving))
    rerender({ source: { value: 'saving' } })

    expect(result.current.draft).toEqual({ value: 'newer' })
  })

  it('ignores an older response after the newer draft is already saved', () => {
    const { result, rerender } = renderHook(
      ({ source }) => useDraftSync({ source, createDraft }),
      { initialProps: { source: { value: 'initial' } } },
    )

    act(() => result.current.setDraft({ value: 'older-save' }))
    const older = result.current.draft
    act(() => result.current.setDraft({ value: 'newer-save' }))
    const newer = result.current.draft
    act(() => result.current.acknowledgeSaved(older))
    act(() => result.current.acknowledgeSaved(newer))
    rerender({ source: { value: 'older-save' } })

    expect(result.current.draft).toEqual({ value: 'newer-save' })
  })

  it('applies a deferred authoritative source after the matching draft is saved', () => {
    const { result, rerender } = renderHook(
      ({ source }) => useDraftSync({ source, createDraft }),
      { initialProps: { source: { value: 'initial' } } },
    )

    act(() => result.current.setDraft({ value: 'secret' }))
    const saving = result.current.draft
    rerender({ source: { value: 'redacted' } })
    expect(result.current.draft).toEqual({ value: 'secret' })

    act(() => result.current.acknowledgeSaved(saving))

    expect(result.current.draft).toEqual({ value: 'redacted' })
  })

  it('does not auto-save the previous draft when readiness and source change together', async () => {
    const onSave = vi.fn(async () => {})
    const { result, rerender } = renderHook(
      ({ source, isReady }) => useSyncedAutoSave({ source, isReady, onSave }),
      { initialProps: { source: { value: 'defaults' }, isReady: false } },
    )

    rerender({ source: { value: 'persisted' }, isReady: true })
    await act(async () => {
      vi.advanceTimersByTime(200)
      await Promise.resolve()
    })

    expect(result.current.draft).toEqual({ value: 'persisted' })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('does not re-save an authoritative source applied after a successful save', async () => {
    const save = deferred<void>()
    const onSave = vi.fn(async () => save.promise)
    const { result, rerender } = renderHook(
      ({ source }) => useAcknowledgedAutoSave({ source, onSave }),
      { initialProps: { source: { value: 'initial' } } },
    )

    act(() => result.current.setDraft({ value: 'secret' }))
    await act(async () => { vi.advanceTimersByTime(100); await Promise.resolve() })
    expect(onSave).toHaveBeenCalledOnce()
    rerender({ source: { value: 'redacted' } })

    await act(async () => {
      save.resolve(undefined)
      await save.promise
      await Promise.resolve()
    })
    expect(result.current.draft).toEqual({ value: 'redacted' })
    await act(async () => { vi.advanceTimersByTime(200); await Promise.resolve() })

    expect(onSave).toHaveBeenCalledOnce()
  })
})

function useSyncedAutoSave({ source, isReady, onSave }: { source: Draft; isReady: boolean; onSave: (draft: Draft) => Promise<void> }) {
  const synced = useDraftSync({ source, createDraft })
  useAutoSave({ value: synced.draft, onSave, isReady, delayMs: 100, baselineRevision: synced.baselineRevision })
  return synced
}

function useAcknowledgedAutoSave({ source, onSave }: { source: Draft; onSave: (draft: Draft) => Promise<void> }) {
  const synced = useDraftSync({ source, createDraft })
  useAutoSave({
    value: synced.draft,
    onSave: async (draft) => {
      await onSave(draft)
      synced.acknowledgeSaved(draft, { value: 'redacted' })
    },
    delayMs: 100,
    baselineRevision: synced.baselineRevision,
  })
  return synced
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
