import { useEffect, useState } from 'react'
import type { ContainerOverview } from '../../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { AsyncPoller } from '@/lib/asyncPoller'
import { logger } from '@/lib/logger'
import { isTerminalGone } from '@/lib/terminalGone'
import { TerminalService } from '@/lib/wails'

type ContainerSnapshot = { terminalID: string; value: ContainerOverview }

export function useContainers(terminalID: string, active: boolean) {
  const [snapshot, setSnapshot] = useState<ContainerSnapshot | null>(null)
  const [failedTerminalID, setFailedTerminalID] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let requestID = 0
    let poller: AsyncPoller | null = null
    const load = async () => {
      const currentRequest = ++requestID
      try {
        const value = await TerminalService.ContainerOverview(terminalID)
        if (!cancelled && currentRequest === requestID && value) {
          setSnapshot({ terminalID, value })
          setFailedTerminalID(null)
        }
      } catch (error: unknown) {
        if (isTerminalGone(error)) {
          if (!cancelled && currentRequest === requestID) setFailedTerminalID(terminalID)
          poller?.stop()
          return
        }
        logger.error('container overview polling failed', error)
        if (!cancelled && currentRequest === requestID) setFailedTerminalID(terminalID)
      }
    }
    setFailedTerminalID((current) => current === terminalID ? null : current)
    poller = new AsyncPoller({ task: load, delayMs: 8000, onError: (error) => logger.error('container overview polling failed', error) })
    void poller.start()
    return () => { cancelled = true; requestID += 1; poller?.stop() }
  }, [active, attempt, terminalID])

  return {
    overview: snapshot?.terminalID === terminalID ? snapshot.value : null,
    failed: failedTerminalID === terminalID,
    refresh: () => {
      setSnapshot(null)
      setFailedTerminalID(null)
      setAttempt((value) => value + 1)
    },
  }
}
