import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      // @xterm/addon-ligatures@0.10.0 publishes only the ESM build but
      // declares main as the missing CJS file; route it to the real entry.
      '@xterm/addon-ligatures': path.resolve(import.meta.dirname, 'node_modules/@xterm/addon-ligatures/lib/addon-ligatures.mjs'),
    },
    // @wailsio/runtime keeps module-level singleton state (clientId,
    // eventListeners, window._wails). It must resolve to a single instance or
    // Events.On registrations land on a different eventListeners map than the
    // one the transport dispatches through.
    dedupe: ['@wailsio/runtime'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@wailsio/runtime')) return 'wails-runtime'
          return undefined
        },
      },
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
      '@wailsio/runtime': path.resolve(import.meta.dirname, 'src/test/__mocks__/wails-runtime.ts'),
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
