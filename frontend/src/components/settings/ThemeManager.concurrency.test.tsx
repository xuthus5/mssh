import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ThemeManager } from '@/components/settings/ThemeManager'

describe('ThemeManager concurrent actions', () => {
  it('surfaces a failed row action while another row remains active', async () => {
    const firstAction = deferred<void>()
    const secondAction = deferred<void>()
    const onCreateProfile = vi.fn()
      .mockImplementationOnce(() => firstAction.promise)
      .mockImplementationOnce(() => secondAction.promise)
    render(
      <ThemeManager
        profiles={[profile(1, 'First'), profile(2, 'Second')] as never}
        onImport={vi.fn()}
        onDeleteProfile={vi.fn()}
        onDeleteDefinition={vi.fn()}
        onCreateProfile={onCreateProfile}
        onUpdateProfile={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: '复制 First' }))
    await userEvent.click(screen.getByRole('button', { name: '复制 Second' }))
    expect(onCreateProfile).toHaveBeenCalledTimes(2)

    await act(async () => {
      firstAction.reject(new Error('first action failed'))
      await Promise.resolve()
    })

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('主题操作失败: first action failed'))
    await act(async () => {
      secondAction.resolve()
      await secondAction.promise
    })
  })
})

function profile(id: number, name: string) {
  return {
    id,
    name,
    theme_id: id,
    follow_global_style: true,
    font_family: 'monospace',
    font_size: 14,
    cursor_style: 'bar',
    color_overrides: '{}',
    definition: {
      id,
      name,
      mode: 'dark',
      source_type: 'builtin',
      source_license: 'MIT',
      is_builtin: true,
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
