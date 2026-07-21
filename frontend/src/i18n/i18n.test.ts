import { beforeEach, describe, expect, it } from 'vitest'
import { hasEnglishTranslation, t, translateMessage, useLanguageStore } from '@/i18n'

describe('i18n', () => {
  beforeEach(() => {
    useLanguageStore.getState().setLanguage('zh-CN')
    localStorage.clear()
  })

  it('defaults to Chinese and returns source text', () => {
    expect(useLanguageStore.getState().language).toBe('zh-CN')
    expect(t('新建会话')).toBe('新建会话')
    expect(t('界面语言')).toBe('界面语言')
  })

  it('switches to English catalog with placeholders', () => {
    useLanguageStore.getState().setLanguage('en')
    expect(t('新建会话')).toBe('New Session')
    expect(t('共 ${} 个会话', 12)).toBe('Total 12 sessions')
    expect(translateMessage('en', '保存设置失败: ${}', 'boom')).toContain('boom')
    expect(hasEnglishTranslation('新建会话')).toBe(true)
  })

  it('persists language preference', () => {
    useLanguageStore.getState().setLanguage('en')
    expect(localStorage.getItem('mssh:ui-language')).toBe('en')
    useLanguageStore.getState().setLanguage('zh-CN')
    expect(localStorage.getItem('mssh:ui-language')).toBe('zh-CN')
  })

  it('keeps proper nouns stable', () => {
    useLanguageStore.getState().setLanguage('en')
    expect(t('SFTP')).toBe('SFTP')
    expect(t('AI')).toBe('AI')
    expect(t('CPU')).toBe('CPU')
  })
})
