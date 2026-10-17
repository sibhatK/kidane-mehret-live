import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const codespacesHost =
  process.env.CODESPACE_NAME &&
  process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
    ? `${process.env.CODESPACE_NAME}-5173.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
    : undefined

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { target: 'safari16.4' },
  server: {
    port: 5173,
    strictPort: true,
    allowedHosts: codespacesHost ? [codespacesHost] : [],
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
  preview: {
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
})
