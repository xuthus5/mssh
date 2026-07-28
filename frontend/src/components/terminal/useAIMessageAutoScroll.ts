import { useEffect, useRef } from 'react'

interface AIMessageAutoScrollOptions {
  enabled: boolean
  visible: boolean
  hasContent: boolean
  contentVersion: string
}

export function useAIMessageAutoScroll(options: AIMessageAutoScrollOptions) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!options.enabled || !options.visible || !options.hasContent) return
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [options.contentVersion, options.enabled, options.hasContent, options.visible])
  return endRef
}
