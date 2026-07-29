import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModelsDevCatalog } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { AIService } from '@/lib/wails'
import { logger } from '@/lib/logger'

export function useModelsDevCatalog() {
  const [catalog, setCatalog] = useState<ModelsDevCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const lifecycle = useRef(0)
  const request = useRef(0)

  const load = useCallback(async (refresh: boolean) => {
    const lifecycleToken = lifecycle.current
    const requestToken = ++request.current
    setLoading(true)
    try {
      const next = await AIService.ModelsDevCatalog(refresh)
      if (lifecycle.current !== lifecycleToken || request.current !== requestToken) return
      setCatalog(next)
      setError(null)
    } catch (loadError) {
      if (lifecycle.current !== lifecycleToken || request.current !== requestToken) return
      setError(loadError instanceof Error ? loadError.message : String(loadError))
      logger.error('load models.dev catalog failed', loadError)
    } finally {
      if (lifecycle.current === lifecycleToken && request.current === requestToken) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const token = ++lifecycle.current
    void load(false)
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [load])

  const refresh = useCallback(() => load(true), [load])
  return { catalog, loading, error, refresh }
}
