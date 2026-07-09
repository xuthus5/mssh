import Sidebar from '@/components/layout/Sidebar'
import TabBar from '@/components/layout/TabBar'
import StatusBar from '@/components/layout/StatusBar'

export default function App() {
  return (
    <div className="flex flex-col h-screen w-screen bg-background">
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0">
          <TabBar />
          <div className="flex-1 min-h-0 bg-background">
            {/* Tab content placeholder */}
          </div>
        </main>
      </div>
      <StatusBar />
    </div>
  )
}
