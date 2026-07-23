export type ConfirmDialogRequest = {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

type Pending = {
  request: ConfirmDialogRequest
  resolve: (value: boolean) => void
}

let pending: Pending | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function subscribeConfirmDialog(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getConfirmDialogSnapshot(): ConfirmDialogRequest | null {
  return pending?.request ?? null
}

/** Show a modal confirm dialog; resolves true when confirmed. */
export function requestConfirm(request: ConfirmDialogRequest): Promise<boolean> {
  if (pending) {
    pending.resolve(false)
    pending = null
  }
  return new Promise<boolean>((resolve) => {
    pending = { request, resolve }
    emit()
  })
}

export function resolveConfirmDialog(value: boolean): void {
  if (!pending) return
  const current = pending
  pending = null
  emit()
  current.resolve(value)
}
