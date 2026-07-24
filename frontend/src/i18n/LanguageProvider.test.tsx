import { useEffect, useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LanguageProvider } from '@/i18n/LanguageProvider'
import { t, useLanguageStore } from '@/i18n'

describe('LanguageProvider', () => {
  beforeEach(() => {
    useLanguageStore.getState().setLanguage('zh-CN')
  })

  it('refreshes translations without remounting stateful children', () => {
    const mounted = vi.fn()
    const unmounted = vi.fn()

    function StatefulCopy() {
      const [count, setCount] = useState(0)
      useEffect(() => {
        mounted()
        return unmounted
      }, [])
      return <button onClick={() => setCount((value) => value + 1)}>{t('新建会话')}:{count}</button>
    }

    render(<LanguageProvider>{() => <StatefulCopy />}</LanguageProvider>)
    fireEvent.click(screen.getByRole('button', { name: '新建会话:0' }))

    act(() => useLanguageStore.getState().setLanguage('en'))

    expect(screen.getByRole('button', { name: 'New Session:1' })).toBeInTheDocument()
    expect(mounted).toHaveBeenCalledOnce()
    expect(unmounted).not.toHaveBeenCalled()
  })
})
