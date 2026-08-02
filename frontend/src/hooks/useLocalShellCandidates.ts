import { useEffect, useState } from 'react'
import { TerminalService } from '@/lib/wails'
import { logger } from '@/lib/logger'

/** Loads the local-machine shell candidates exposed by the backend. */
export function useLocalShellCandidates(): string[] {
  const [candidates, setCandidates] = useState<string[]>([])
  useEffect(() => {
    let active = true
    void TerminalService.ListLocalShellCandidates().then((shells) => {
      if (active) setCandidates(shells ?? [])
    }).catch((error: unknown) => {
      logger.error('list local shell candidates failed', error)
      if (active) setCandidates([])
    })
    return () => { active = false }
  }, [])
  return candidates
}