import type { MutableRefObject } from 'react'
import { t } from '@/i18n'

interface CreateFileRuntime {
  lifecycle: MutableRefObject<number>
  generation: MutableRefObject<number>
  requestID: MutableRefObject<number>
  active: MutableRefObject<boolean>
}

interface CreateFileSubmitOptions {
  runtime: CreateFileRuntime
  panelOpen: boolean
  name: string
  currentPath: string
  externalBusy: boolean
  setBusy: (busy: boolean) => void
  setError: (error: string) => void
  onOpenChange: (open: boolean) => void
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Mirrors the mkdir lease so a mounted dialog cannot outlive its directory or panel. */
export function createCreateFileSubmit(options: CreateFileSubmitOptions) {
  return async (onCreate: (name: string) => void | Promise<void>) => {
    const { runtime } = options
    const targetName = options.name.trim()
    if (!targetName || runtime.active.current || options.externalBusy) return
    runtime.active.current = true
    const lifecycleToken = runtime.lifecycle.current
    const generationToken = runtime.generation.current
    const id = ++runtime.requestID.current
    const isLatest = () => runtime.lifecycle.current === lifecycleToken && runtime.requestID.current === id
    const isCurrent = () => isLatest() && runtime.generation.current === generationToken && options.panelOpen
    options.setBusy(true)
    options.setError('')
    try {
      await onCreate(targetName)
      if (isCurrent()) options.onOpenChange(false)
    } catch (error) {
      if (isCurrent()) options.setError(t('创建文件失败: ${}', errorText(error)))
    } finally {
      if (runtime.requestID.current === id) runtime.active.current = false
      if (isLatest()) options.setBusy(false)
    }
  }
}
