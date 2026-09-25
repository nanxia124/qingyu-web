import { defineConfig, loadEnv, type Plugin, type PreviewServer, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { readFileSync, rmSync } from 'node:fs'
import { parseChangelog } from './src/canvas/lib/release'

// 画布模块（src/canvas）的版本与更新日志构建常量
const localVersion = readFileSync(path.resolve(__dirname, './VERSION'), 'utf8').trim() || 'dev'
const localChangelog = readFileSync(path.resolve(__dirname, './CHANGELOG.md'), 'utf8')
function localTarget(value: string, setting: string): string {
  let target: URL
  try { target = new URL(value) } catch { throw new Error(`${setting} 必须是有效的本机 HTTP 地址`) }
  if (!['http:', 'https:'].includes(target.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
    || target.username || target.password || target.search || target.hash
    || target.pathname !== '/') {
    throw new Error(`${setting} 只允许本机地址，本地开发禁止连接生产或其他远程服务器`)
  }
  return target.origin
}

// 未安装本地身份服务时直接说明原因，不把登录请求转发到生产。
function unavailableAppwrite(server: ViteDevServer | PreviewServer) {
  server.middlewares.use((req, res, next) => {
    const pathname = req.url?.split('?')[0]
    if (pathname !== '/v1' && !pathname?.startsWith('/v1/')) return next()
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ message: '未配置本地身份服务，请配置本机 VITE_APPWRITE_PROXY_TARGET；本地开发不会连接生产服务。', code: 503 }))
  })
  server.httpServer?.on('upgrade', (req, socket) => {
    const pathname = req.url?.split('?')[0]
    if (pathname === '/v1' || pathname?.startsWith('/v1/')) socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
  })
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const isLocalServer = command === 'serve'
  const apiProxyTarget = isLocalServer ? localTarget(env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3001', 'VITE_API_PROXY_TARGET') : 'http://127.0.0.1:3001'
  const appwriteProxyTarget = isLocalServer && env.VITE_APPWRITE_PROXY_TARGET
    ? localTarget(env.VITE_APPWRITE_PROXY_TARGET, 'VITE_APPWRITE_PROXY_TARGET') : ''
  // 页面中的计费、生图与后台请求也可以配置绝对地址，必须一并检查，避免绕过代理。
  if (isLocalServer && env.VITE_API_URL) localTarget(env.VITE_API_URL, 'VITE_API_URL')
  const localIdentityPlugin: Plugin = {
    name: 'local-identity-isolation',
    configureServer: appwriteProxyTarget ? undefined : unavailableAppwrite,
    configurePreviewServer: appwriteProxyTarget ? undefined : unavailableAppwrite,
  }
  let speechArchiveOutputPath = ''
  const removeDuplicateSpeechArchive: Plugin = {
    name: 'remove-duplicate-speech-model-archive',
    apply: 'build',
    configResolved(config) {
      speechArchiveOutputPath = path.resolve(config.root, config.build.outDir, 'models/sherpa-onnx-wasm-asr-1pass.zip')
    },
    closeBundle() {
      if (speechArchiveOutputPath) rmSync(speechArchiveOutputPath, { force: true })
    },
  }
  return {
  plugins: [react(), tailwindcss(), localIdentityPlugin, removeDuplicateSpeechArchive],
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
        target: apiProxyTarget,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const requestPath = req.url?.split('?')[0]
            const remoteAddress = req.socket.remoteAddress || ''
            const isLoopbackClient = remoteAddress === '127.0.0.1'
              || remoteAddress === '::1'
              || remoteAddress === '::ffff:127.0.0.1'
            // 不允许请求者自行伪造本地开发登录标记。
            proxyReq.removeHeader('X-Qingyu-Local-Dev-Login')
            if (requestPath === '/api/dev-login' && isLoopbackClient) {
              proxyReq.setHeader('X-Qingyu-Local-Dev-Login', '1')
            }
          })
        },
      },
      // 身份服务必须显式配置为本机地址；正式部署仍使用 Nginx。
      ...(appwriteProxyTarget ? { '/v1': {
        target: appwriteProxyTarget,
        changeOrigin: true,
        ws: true,
      } } : {}),
    },
  },
  }
})
