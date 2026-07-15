import { useEffect, useState } from 'react'
import { useSessionWorkspace } from '@/hooks/SessionWorkspaceContext'
import { SessionQuickSearchDialog } from '@/components/session/SessionQuickSearchDialog'
import { SESSION_QUICK_SEARCH_EVENT } from '@/lib/sessionQuickSearch'

export function SessionQuickSearchHost() {
  const [open, setOpen] = useState(false)
  const workspace = useSessionWorkspace()

  useEffect(() => {
    const openSearch = () => setOpen(true)
    window.addEventListener(SESSION_QUICK_SEARCH_EVENT, openSearch)
    return () => window.removeEventListener(SESSION_QUICK_SEARCH_EVENT, openSearch)
  }, [])

  return <SessionQuickSearchDialog open={open} onOpenChange={setOpen}
    sessions={workspace.sessions} folders={workspace.folders} onConnect={workspace.connect} />
}
