import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
        timeout: 120000,
        proxyTimeout: 120000,
      },
      '/api/proxy': {
        target: 'https://rh-images.xiaoyaoyou.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/proxy/, ''),
      },
    },
  },
  build: {
    // 移动端加载速度优化
    target: 'es2018', // 兼容主流移动浏览器（iOS 12+ / Android Chrome 70+），减小 polyfill 体积
    cssCodeSplit: true, // CSS 按页面分割，移动端只加载所需样式
    minify: 'esbuild', // esbuild 比 terser 更快，产物略大但速度显著提升
    rollupOptions: {
      output: {
        // 拆分 React / 大体积第三方库为独立 chunk，提升缓存命中率
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'icons': ['lucide-react'],
        },
      },
    },
    chunkSizeWarningLimit: 1500, // 单页超过 1.5MB 才警告（移动端允许更大的代码分块）
  },
})
