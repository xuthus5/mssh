import { create } from 'zustand'
import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, type AppLanguage } from '@/i18n/types'
import { readStorageItem, writeStorageItem } from '@/lib/safeStorage'

function normalizeLanguage(value: unknown): AppLanguage {
  return value === 'en' ? 'en' : DEFAULT_LANGUAGE
}

function readStoredLanguage(): AppLanguage {
  return normalizeLanguage(readStorageItem(LANGUAGE_STORAGE_KEY))
}

function persistLanguage(language: AppLanguage) {
  writeStorageItem(LANGUAGE_STORAGE_KEY, language)
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN'
  }
}

interface LanguageState {
  language: AppLanguage
  setLanguage: (language: AppLanguage) => void
  hydrateLanguage: (language: AppLanguage) => void
}

export const useLanguageStore = create<LanguageState>((set) => ({
  language: readStoredLanguage(),
  setLanguage: (language) => {
    const next = normalizeLanguage(language)
    persistLanguage(next)
    set({ language: next })
  },
  hydrateLanguage: (language) => {
    const next = normalizeLanguage(language)
    persistLanguage(next)
    set({ language: next })
  },
}))

persistLanguage(useLanguageStore.getState().language)

export function getLanguage(): AppLanguage {
  return useLanguageStore.getState().language
}
