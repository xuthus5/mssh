import { useCallback } from 'react'
import { translateMessage } from '@/i18n/translate'
import { useLanguageStore } from '@/i18n/languageStore'
import type { AppLanguage } from '@/i18n/types'

export function useI18n() {
  const language = useLanguageStore((state) => state.language)
  const setLanguage = useLanguageStore((state) => state.setLanguage)
  const t = useCallback((message: string, ...args: Array<string | number>) => {
    return translateMessage(language, message, ...args)
  }, [language])
  return { language, setLanguage, t }
}

/** Non-hook translator for modules outside React render (toasts, stores, helpers). */
export function t(message: string, ...args: Array<string | number>): string {
  return translateMessage(useLanguageStore.getState().language, message, ...args)
}

export function currentLanguage(): AppLanguage {
  return useLanguageStore.getState().language
}
