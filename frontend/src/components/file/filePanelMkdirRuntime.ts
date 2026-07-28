import type { FormEvent, MutableRefObject } from 'react'
import { t } from '@/i18n'

interface MkdirRuntime {
  lifecycle: MutableRefObject<number>
  generation: MutableRefObject<number>
  mkdirRequest: MutableRefObject<number>
  mkdirActive: MutableRefObject<boolean>
}

interface MkdirSubmitOptions {
  runtime: MkdirRuntime
  panelOpen: boolean
  mkdirName: string
  setMkdirName: (name: string) => void
  setShowMkdir: (open: boolean) => void
  setMkdirPending: (pending: boolean) => void
  setMutationError: (error: string) => void
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createMkdirSubmit(options: MkdirSubmitOptions) {
  return async (event: FormEvent, onMakeDir: (name: string) => void | Promise<void>, externalBusy: boolean) => {
    event.preventDefault()
    const { runtime } = options
    if (!options.mkdirName.trim() || runtime.mkdirActive.current || externalBusy) return
    runtime.mkdirActive.current = true
    const lifecycleToken = runtime.lifecycle.current
    const generationToken = runtime.generation.current
    const request = ++runtime.mkdirRequest.current
    const isLatest = () => runtime.lifecycle.current === lifecycleToken && runtime.mkdirRequest.current === request
    const isCurrent = () => isLatest() && runtime.generation.current === generationToken && options.panelOpen
    const targetName = options.mkdirName.trim()
    options.setMkdirPending(true)
    options.setMutationError('')
    try {
      await onMakeDir(targetName)
      if (!isCurrent()) return
      options.setMkdirName('')
      options.setShowMkdir(false)
    } catch (error) {
      if (isCurrent()) options.setMutationError(t('创建目录失败: ${}', errorText(error)))
    } finally {
      if (runtime.mkdirRequest.current === request) runtime.mkdirActive.current = false
      if (isLatest()) options.setMkdirPending(false)
    }
  }
}
