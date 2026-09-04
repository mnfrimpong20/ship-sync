import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  server: { host: true, port: 5000, allowedHosts: true },
  preview: { host: true, port: 5000, allowedHosts: true },
})
