import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: parseInt(process.env.WAILS_VITE_PORT || '5173'),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    alias: {
      '@wailsio/runtime': path.resolve(__dirname, 'src/test/__mocks__/wails-runtime.ts'),
    },
    coverage: {
      provider: 'v8',
      include: [
        'src/App.tsx',
        'src/hooks/**',
        'src/components/session/**',
        'src/components/layout/Sidebar.tsx',
        'src/components/layout/DynamicTabStrip.tsx',
        'src/components/layout/WindowTitleBar.tsx',
        'src/components/layout/WorkspaceContent.tsx',
        'src/components/settings/SettingsDialog.tsx',
        'src/components/settings/ThemeEditor.tsx',
        'src/components/settings/ThemeModeSelector.tsx',
        'src/components/settings/themeEditorState.ts',
        'src/components/terminal/**/*.{ts,tsx}',
        'src/lib/effectiveTerminalTheme.ts',
        'src/store/**',
      ],
      // Tests and generated Wails bindings are not handwritten production code.
      exclude: ['src/**/*.test.{ts,tsx}', 'bindings/**'],
      thresholds: { lines: 90, functions: 90 },
    },
  },
})
