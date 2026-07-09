import { useState } from 'react'

type SidebarTab = 'sessions' | 'macros'

export default function Sidebar() {
  const [activeTab, setActiveTab] = useState<SidebarTab>('sessions')

  return (
    <aside className="w-[280px] flex-shrink-0 flex flex-col border-r border-border bg-card">
      <div className="flex border-b border-border">
        <button
          type="button"
          className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === 'sessions'
              ? 'bg-background text-foreground border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('sessions')}
        >
          会话
        </button>
        <button
          type="button"
          className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === 'macros'
              ? 'bg-background text-foreground border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('macros')}
        >
          宏
        </button>
      </div>
      <div className="flex-1 min-h-0 p-4">
        <p className="text-sm text-muted-foreground">
          {activeTab === 'sessions' ? '暂无会话' : '暂无宏'}
        </p>
      </div>
    </aside>
  )
}
