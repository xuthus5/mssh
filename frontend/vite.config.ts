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
    port: parseInt(process.env.WAILS_VITE_PORT || '5173'),
    strictPort: true,
  },
  optimizeDeps: {
    exclude: ['/wails/runtime.js'],
  },
  build: {
    rollupOptions: {
      external: ['/wails/runtime.js'],
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
    resolve: {
      alias: {
        '/wails/runtime.js': path.resolve(__dirname, 'src/test/__mocks__/wails-runtime.ts'),
      },
    },
    coverage: {
      provider: 'v8',
      include: ['src/hooks/**', 'src/components/session/**', 'src/components/layout/Sidebar.tsx', 'src/store/**'],
      thresholds: { lines: 80, functions: 80 },
    },
  },
})
