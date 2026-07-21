import { create } from 'zustand'
import { X } from 'lucide-react'
import { t } from '@/i18n'


export interface Toast {
  id: string
  type: 'info' | 'error' | 'success' | 'warning'
  message: string
  duration?: number
}

interface ToastState {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

let toastId = 0

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (toast) => {
    const id = `toast-${++toastId}`
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }))
    const duration = toast.duration ?? 4000
    if (duration > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
      }, duration)
    }
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export function toast(message: string, type: Toast['type'] = 'info') {
  useToastStore.getState().addToast({ message, type })
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)
  const removeToast = useToastStore((s) => s.removeToast)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-12 right-4 flex flex-col gap-2 pointer-events-none" aria-live="polite" aria-atomic="false">
      {toasts.map((item) => {
        const bg = {
          info: 'bg-secondary text-secondary-foreground',
          error: 'bg-destructive',
          success: 'bg-primary text-primary-foreground',
          warning: 'bg-accent text-accent-foreground',
        }[item.type]
        return (
          <div
            key={item.id}
            className={`${bg} flex items-center gap-3 px-4 py-2 rounded-lg shadow-lg text-sm pointer-events-auto animate-in slide-in-from-right`}
            role={item.type === 'error' ? 'alert' : 'status'}
          >
            <span>{item.message}</span>
            <button type="button" aria-label={t('关闭通知')} onClick={() => removeToast(item.id)}><X className="size-4" /></button>
          </div>
        )
      })}
    </div>
  )
}
