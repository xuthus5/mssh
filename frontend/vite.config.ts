import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '/wails/runtime.js': path.resolve(__dirname, 'src/test/__mocks__/wails-runtime.ts'),
    },
  },
  server: {
    port: parseInt(process.env.WAILS_VITE_PORT || '5173'),
    strictPort: true,
  },
  build: {
    rollupOptions: {
      external: [/^\/wails\//],
      output: {
        manualChunks: undefined,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    coverage: {
      provider: 'v8',
      include: ['src/hooks/**', 'src/components/session/**', 'src/components/layout/Sidebar.tsx', 'src/store/**'],
      thresholds: { lines: 80, functions: 80 },
    },
  },
})
