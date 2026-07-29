import { useEffect, useState } from 'react'
import { Bot } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { AIAgentSessionPanel, AIAgentTaskWorkspace } from '@/components/agent/AIAgentTaskViews'
import { useAIAgentTasks } from '@/hooks/useAIAgentTasks'
import { OPEN_AI_AGENT_CENTER_EVENT, type AIAgentCenterTarget } from '@/lib/aiAgentEvents'
import { t } from '@/i18n'

export function AIAgentTaskCenter() {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<AIAgentCenterTarget>({})
  const allTasks = useAIAgentTasks(0, open && !target.sessionID)
  useEffect(() => {
    const listener = (event: Event) => {
      setTarget((event as CustomEvent<AIAgentCenterTarget>).detail ?? {})
      setOpen(true)
    }
    window.addEventListener(OPEN_AI_AGENT_CENTER_EVENT, listener)
    return () => window.removeEventListener(OPEN_AI_AGENT_CENTER_EVENT, listener)
  }, [])
  return <Sheet open={open} onOpenChange={setOpen}><SheetContent className="w-[min(94vw,960px)] sm:max-w-[960px]" side="right"><SheetHeader className="border-b border-border"><SheetTitle className="flex items-center gap-2"><Bot className="size-4 text-primary" />{t('Agent 任务中心')}</SheetTitle><SheetDescription>{target.sessionID ? t('在 ${} 上创建任务并跟踪审批。', target.sessionName ?? '') : t('查看运行中、待审批、中断与历史任务。')}</SheetDescription></SheetHeader>
    {target.sessionID ? <AIAgentSessionPanel sessionID={target.sessionID} sessionName={target.sessionName ?? String(target.sessionID)} /> : <AIAgentTaskWorkspace controller={allTasks} />}
  </SheetContent></Sheet>
}
