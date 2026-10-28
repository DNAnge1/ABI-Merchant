import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // GitHub Pages project site: https://dnange1.github.io/ABI-Merchant/
  base: process.env.GITHUB_PAGES === '1' ? '/ABI-Merchant/' : '/',
})
