import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => ({
  general: {}, systemFonts: [], keys: [], sync: {}, saveGeneral: vi.fn(), previewUIFont: vi.fn(),
  generateKey: vi.fn(), importKey: vi.fn(), deleteKey: vi.fn(),
  exportKey: vi.fn(), exportConfig: vi.fn(), importConfig: vi.fn(),
}))
const catalog = vi.hoisted(() => ({
  profiles: [], assignments: {}, globalStyle: {}, colorMode: 'dark', saveConfiguration: vi.fn(),
  importThemes: vi.fn(), createProfile: vi.fn(), saveProfile: vi.fn(), deleteProfile: vi.fn(),
  deleteDefinition: vi.fn(), resetBuiltinStyles: vi.fn(),
}))

vi.mock('@/hooks/useSettings', () => ({ useSettings: () => settings }))
vi.mock('@/hooks/useCloudSyncCenter', () => ({ useCloudSyncCenter: () => ({ dashboard: null, loading: false, pending: null, error: null, reload: vi.fn(async () => {}), saveConfig: vi.fn(async () => {}), testProvider: vi.fn(async () => {}), syncNow: vi.fn(async () => {}), pushNow: vi.fn(async () => {}), pullNow: vi.fn(async () => {}), resolveConflict: vi.fn(async () => {}), restoreVersion: vi.fn(async () => {}), deleteVersion: vi.fn(async () => {}), resetLocalData: vi.fn(async () => {}) }) }))
vi.mock('@/hooks/useThemeCatalog', () => ({ useThemeCatalog: () => catalog }))
vi.mock('@/components/settings/SettingsView', () => ({ SettingsView: () => <main>settings-content</main> }))
vi.mock('@/components/settings/SettingsWindowTitleBar', () => ({ SettingsWindowTitleBar: () => <header>设置</header> }))
vi.mock('@/components/security/VaultGate', () => ({ VaultGate: ({ children }: { children: React.ReactNode }) => children }))

import { SettingsWindowApp } from '@/components/settings/SettingsWindowApp'

describe('SettingsWindowApp', () => {
  it('renders only the native settings window shell and settings content', () => {
    render(<SettingsWindowApp />)
    expect(screen.getByRole('banner')).toHaveTextContent('设置')
    expect(screen.getByRole('main')).toHaveTextContent('settings-content')
    expect(screen.queryByText('Secure Shell Client & Session Manager')).not.toBeInTheDocument()
  })
})
