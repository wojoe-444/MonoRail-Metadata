import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // The app server (server/index.ts) answers /api: OpenMetadata pass-through and Malloy.
  server: {
    proxy: { '/api': { target: `http://localhost:${process.env.PORT ?? 8787}`, changeOrigin: true } },
  },
  // Relative asset URLs, so the build also loads from a subfolder.
  base: './',
})
