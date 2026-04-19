import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api/proxy': {
        target: 'https://rh-images.xiaoyaoyou.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/proxy/, ''),
      },
    },
  },
})
