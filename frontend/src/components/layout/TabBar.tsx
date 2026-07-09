import { X } from 'lucide-react'
import { useAppStore } from '@/store/appStore'

export default function TabBar() {
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const closeTab = useAppStore((s) => s.closeTab)

  if (tabs.length === 0) {
    return null
  }

  return (
    <div className="flex items-center border-b border-border bg-card overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId
        return (
          <div
            key={tab.id}
            className={`group flex items-center gap-1.5 px-3 py-2 text-sm cursor-pointer border-r border-border transition-colors select-none ${
              isActive
                ? 'bg-background text-foreground'
                : 'text-muted-foreground hover:bg-secondary/50'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="truncate max-w-[160px]">{tab.title}</span>
            <button
              type="button"
              className={`flex-shrink-0 rounded-sm p-0.5 hover:bg-muted transition-opacity ${
                isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
