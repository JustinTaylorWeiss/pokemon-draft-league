import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Project sites on GitHub Pages are served from /<repo>/, so assets need that
// prefix in production. Local dev stays at the root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/pokemon-draft-league/' : '/',
  plugins: [react()],
}))
