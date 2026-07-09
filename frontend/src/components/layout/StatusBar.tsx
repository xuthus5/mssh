import { useAppStore } from '@/store/appStore'
import { Gauge } from 'lucide-react'

export default function StatusBar() {
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)

  const activeTab = tabs.find((t) => t.id === activeTabId)

  return (
    <footer className="flex-shrink-0 flex items-center justify-between px-3 py-1 border-t border-border bg-card text-xs text-muted-foreground">
      <div className="flex items-center gap-3">
        <span>
          {activeTab
            ? `${activeTab.title} — ${activeTab.type}`
            : '未连接'}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <Gauge className="h-3 w-3" />
          传输进度占位
        </span>
      </div>
    </footer>
  )
}
