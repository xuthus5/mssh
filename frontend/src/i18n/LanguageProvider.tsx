import type { ReactNode } from 'react'
import { useLanguageStore } from '@/i18n/languageStore'

/** Remounts the tree when language changes so all t() calls refresh. */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const language = useLanguageStore((state) => state.language)
  return <div key={language} data-language={language} className="contents">{children}</div>
}
