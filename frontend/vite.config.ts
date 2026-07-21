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
        'src/hooks/**/*.{ts,tsx}',
        'src/components/session/**/*.{ts,tsx}',
        'src/components/layout/**/*.{ts,tsx}',
        'src/components/settings/**/*.{ts,tsx}',
        'src/components/file/**/*.{ts,tsx}',
        'src/components/terminal/**/*.{ts,tsx}',
        'src/lib/**/*.{ts,tsx}',
        'src/store/**/*.{ts,tsx}',
      ],
      // Tests and generated Wails bindings are not handwritten production code.
      exclude: ['src/**/*.test.{ts,tsx}', 'bindings/**'],
      thresholds: { lines: 90, functions: 90 },
    },
  },
})
