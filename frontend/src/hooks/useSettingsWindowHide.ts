import { useEffect, useRef } from 'react'
import { Events } from '@wailsio/runtime'
import { SETTINGS_PREVIEW_CANCELLED_EVENT } from '@/lib/settingsWindowEvents'

export function useSettingsWindowHide(onHide: () => void, enabled = true) {
  const onHideRef = useRef(onHide)
  onHideRef.current = onHide
  useEffect(() => {
    if (!enabled) return
    return Events.On(SETTINGS_PREVIEW_CANCELLED_EVENT, () => onHideRef.current())
  }, [enabled])
}
