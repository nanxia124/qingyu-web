import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { parseChangelog } from './src/canvas/lib/release'

// 画布模块（src/canvas）的版本与更新日志构建常量
const localVersion = readFileSync(path.resolve(__dirname, '../VERSION'), 'utf8').trim() || 'dev'
const localChangelog = readFileSync(path.resolve(__dirname, '../CHANGELOG.md'), 'utf8')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@canvas': path.resolve(__dirname, './src/canvas'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(localVersion),
    __APP_RELEASES__: JSON.stringify(parseChangelog(localChangelog)),
  },
  server: {
    port: 5173,
    proxy: {
      // 网页端后端网关代理（qingyu_server，默认 3001）
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
