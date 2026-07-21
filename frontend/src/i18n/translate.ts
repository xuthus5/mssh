import { enCatalog } from '@/i18n/enCatalog'
import type { AppLanguage } from '@/i18n/types'

const placeholder = /\{\}|\$\{\}/g

/** Translate a Chinese source string (or already-English string) for the active language. */
export function translateMessage(language: AppLanguage, message: string, ...args: Array<string | number>): string {
  const template = language === 'en' ? (enCatalog[message] ?? message) : message
  if (args.length === 0) return template
  let index = 0
  return template.replace(placeholder, () => {
    const value = args[index]
    index += 1
    return value === undefined || value === null ? '' : String(value)
  })
}

export function hasEnglishTranslation(message: string): boolean {
  return Object.prototype.hasOwnProperty.call(enCatalog, message)
}
