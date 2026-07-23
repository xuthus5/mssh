import { beforeEach, describe, expect, it } from 'vitest'
import { hasEnglishTranslation, t, translateMessage, useLanguageStore } from '@/i18n'
import { enCatalog } from '@/i18n/enCatalog'

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

  it('rejects CJK leftovers and glued English catalog values', async () => {
    const catalog = (await import('@/i18n/en.json')).default as Record<string, string>
    const cjkKeys = Object.entries(catalog).filter(([, value]) => /[一-鿿]/.test(value)).map(([key]) => key)
    expect(cjkKeys).toEqual([])
    expect(catalog['打开设置']).toBe('Open settings')
    expect(catalog['批量设置环境']).toBe('Batch set environment')
    expect(catalog['安全配置']).toBe('Security configuration')
    expect(catalog['加载隧道失败: ${}']).toBe('Failed to load tunnels: ${}')
    expect(catalog['输入SSH密码']).toBe('Enter SSH password')
  })

  it('keeps english catalog free of glued labels for multi-word chinese keys', () => {
    const glued = Object.entries(enCatalog).filter(([key, value]) => {
      if (typeof value !== 'string') return false
      if (!/[一-鿿]/.test(key)) return false
      if (value.includes(' ') || /[:/\\${}]/.test(value)) return false
      if (!/^[A-Za-z][A-Za-z0-9''’\-]*$/.test(value)) return false
      if (value.length < 10) return false
      const allow = new Set([
        'Foreground', 'Description', 'Recordings', 'Production', 'Transferring', 'Reconnecting',
        'Disconnected', 'Connecting', 'Recording', 'Playback', 'Authentication', 'Configuration',
        'Environment', 'Successfully', 'Blue-Green',
      ])
      return !allow.has(value)
    })
    expect(glued).toEqual([])
  })
})
