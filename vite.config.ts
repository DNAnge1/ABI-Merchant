import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // GitHub Pages project site: https://dnange1.github.io/ABI-Merchant/
  base: process.env.GITHUB_PAGES === '1' ? '/ABI-Merchant/' : '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
