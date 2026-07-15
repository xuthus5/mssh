import ReactDOM from 'react-dom/client'
import './styles/globals.css'
import { TooltipProvider } from '@/components/ui/tooltip'
import { logger } from '@/lib/logger'

async function selectedRoot() {
  const settingsWindow = new URLSearchParams(window.location.search).get('window') === 'settings'
  if (settingsWindow) return (await import('@/components/settings/SettingsWindowApp')).SettingsWindowApp
  const [{ default: App }, { startEventBridge }] = await Promise.all([import('./App'), import('@/store/eventBridge')])
  startEventBridge()
  return App
}

async function mount() {
  const Root = await selectedRoot()
  ReactDOM.createRoot(document.getElementById('root')!).render(<TooltipProvider><Root /></TooltipProvider>)
}

void mount().catch((error: unknown) => logger.error('mount application failed', error))
