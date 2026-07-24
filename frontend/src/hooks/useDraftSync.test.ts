import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useDraftSync } from '@/hooks/useDraftSync'

interface Draft {
  value: string
}

const createDraft = (source: Draft) => ({ ...source })

describe('useDraftSync', () => {
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
})
