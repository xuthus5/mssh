import type { ReactNode } from 'react'
import { useLanguageStore } from '@/i18n/languageStore'
import type { AppLanguage } from '@/i18n/types'

type LanguageRenderer = (language: AppLanguage) => ReactNode

export function LanguageProvider({ children }: { children: LanguageRenderer }) {
  const language = useLanguageStore((state) => state.language)
  return <div data-language={language} className="contents">{children(language)}</div>
}
