import { create } from 'zustand'

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
    <div className="fixed bottom-12 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => {
        const bg = {
          info: 'bg-blue-600',
          error: 'bg-destructive',
          success: 'bg-green-600',
          warning: 'bg-yellow-600',
        }[t.type]
        return (
          <div
            key={t.id}
            className={`${bg} text-white px-4 py-2 rounded-lg shadow-lg text-sm pointer-events-auto cursor-pointer animate-in slide-in-from-right`}
            onClick={() => removeToast(t.id)}
          >
            {t.message}
          </div>
        )
      })}
    </div>
  )
}
