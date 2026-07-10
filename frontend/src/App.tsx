import Sidebar from '@/components/layout/Sidebar'
import TabBar from '@/components/layout/TabBar'
import StatusBar from '@/components/layout/StatusBar'
import { TerminalTab } from '@/components/terminal/TerminalTab'
import { useAppStore } from '@/store/appStore'

function TabContent() {
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const activeTab = tabs.find((t) => t.id === activeTabId)

  if (!activeTab) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">
          新建会话后双击连接，或选择已有会话开始
        </p>
      </div>
    )
  }

  switch (activeTab.type) {
    case 'terminal':
      return (
        <TerminalTab terminalID={activeTab.terminalId ?? activeTab.id} />
      )
    case 'settings':
      return (
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">设置</p>
        </div>
      )
    case 'playback':
      return (
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">回放</p>
        </div>
      )
    default:
      return null
  }
}

export default function App() {
  return (
    <div className="flex flex-col h-screen w-screen bg-background">
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0">
          <TabBar />
          <TabContent />
        </main>
      </div>
      <StatusBar />
    </div>
  )
}
