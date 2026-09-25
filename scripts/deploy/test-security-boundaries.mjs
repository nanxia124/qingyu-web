import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import yaml from 'js-yaml';
import ts from 'typescript';
import { loadEnv } from 'vite';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const directory = await mkdtemp(path.join(scriptDirectory, '.security-test-'));
const secret = crypto.randomBytes(32).toString('hex');
let child;
let stopped;

function signToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300, ...payload })).toString('base64url');
  return `${header}.${body}.${crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')}`;
}

async function verifyLocalIsolation(serverSource, storeSource) {
  const projectRoot = path.resolve(scriptDirectory, '../..');
  const viteSource = await readFile(path.join(projectRoot, 'vite.config.ts'), 'utf8');
  const configCode = ts.transpileModule(viteSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    .replace(/^import .*;\r?\n/gm, '').replace('export default ', 'globalThis.configFactory = ');
  const context = vm.createContext({
    URL, path, __dirname: projectRoot, readFileSync: (file) => file.endsWith('VERSION') ? 'test' : '',
    parseChangelog: () => [], defineConfig: value => value, loadEnv,
    react: () => ({}), tailwindcss: () => ({}), process: { cwd: () => directory },
  });
  vm.runInContext(configCode, context);
  const settings = ['VITE_API_PROXY_TARGET', 'VITE_APPWRITE_PROXY_TARGET', 'VITE_API_URL', 'VITE_OAUTH_ORIGIN'];
  const saved = settings.map(key => [key, process.env[key]]);
  try {
    for (const key of settings) delete process.env[key];
    const local = context.configFactory({ command: 'serve', mode: 'development' });
    assert.equal(local.server.proxy['/api'].target, 'http://127.0.0.1:3001');
    assert.equal(local.server.proxy['/v1'], undefined, '未配置身份服务时不得回退到生产');
    for (const key of settings.slice(0, 3)) {
      for (const target of ['https://litzone.art', 'http://43.160.249.6', 'https://localhost.evil.invalid', 'http://localhost@remote.invalid', 'file:///tmp/service']) {
        process.env[key] = target;
        assert.throws(() => context.configFactory({ command: 'serve', mode: 'development' }), /只允许本机|有效的本机/);
        assert.throws(() => context.configFactory({ command: 'serve', mode: 'production' }), /只允许本机|有效的本机/, '本地预览不能用 production 模式绕过检查');
      }
      delete process.env[key];
    }
    await writeFile(path.join(directory, '.env.local'), 'VITE_API_URL=https://remote.invalid\n');
    assert.throws(() => context.configFactory({ command: 'serve', mode: 'development' }), /VITE_API_URL/, '环境文件也必须被检查');
    await writeFile(path.join(directory, '.env.local'), '');
    process.env.VITE_APPWRITE_PROXY_TARGET = 'http://[::1]:8081';
    assert.equal(context.configFactory({ command: 'serve', mode: 'development' }).server.proxy['/v1'].target, 'http://[::1]:8081');
    delete process.env.VITE_APPWRITE_PROXY_TARGET;
    process.env.VITE_API_URL = 'https://production.example.invalid';
    assert.doesNotThrow(() => context.configFactory({ command: 'build', mode: 'production' }), '正式构建保留正式地址配置能力');
    delete process.env.VITE_API_URL;

    // 真正发起本机 HTTP 与 WebSocket 请求，检查未配置身份服务时的失败行为。
    let middleware;
    const localServer = http.createServer((req, res) => middleware(req, res, () => res.end('其他本地页面')));
    const plugin = local.plugins.find(item => item.name === 'local-identity-isolation');
    plugin.configureServer({ middlewares: { use: handler => { middleware = handler; } }, httpServer: localServer });
    localServer.listen(0, '127.0.0.1');
    await once(localServer, 'listening');
    try {
      const port = localServer.address().port;
      const response = await fetch(`http://127.0.0.1:${port}/v1/account`);
      assert.equal(response.status, 503);
      assert.match((await response.json()).message, /未配置本地身份服务/);
      assert.equal((await fetch(`http://127.0.0.1:${port}/other`)).status, 200);
      const upgradeResponse = await new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1');
        let text = '';
        socket.setTimeout(2000, () => { socket.destroy(); reject(new Error('本地身份 WebSocket 未及时拒绝')); });
        socket.on('error', reject);
        socket.on('data', chunk => { text += chunk; });
        socket.on('end', () => { socket.destroy(); resolve(text); });
        socket.on('connect', () => socket.write('GET /v1/realtime HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'));
      });
      assert.match(upgradeResponse, /^HTTP\/1.1 503/);
    } finally { await new Promise(resolve => localServer.close(resolve)); }
    let previewMiddleware;
    plugin.configurePreviewServer({ middlewares: { use: handler => { previewMiddleware = handler; } } });
    assert.equal(typeof previewMiddleware, 'function');

    // 即使手工伪造标记，也只能由本机访问开发登录路由时重新设置。
    let onProxyRequest;
    local.server.proxy['/api'].configure({ on: (_event, handler) => { onProxyRequest = handler; } });
    for (const [address, requestPath, expected] of [['192.0.2.1', '/api/dev-login', false], ['127.0.0.1', '/api/dev-login', true], ['127.0.0.1', '/api/config/public', false]]) {
      const headers = new Map([['X-Qingyu-Local-Dev-Login', '1']]);
      onProxyRequest({ removeHeader: name => headers.delete(name), setHeader: (name, value) => headers.set(name, value) }, { url: requestPath, socket: { remoteAddress: address } });
      assert.equal(headers.has('X-Qingyu-Local-Dev-Login'), expected);
    }
  } finally {
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }

  const authSource = await readFile(path.join(projectRoot, 'src/stores/useAuthStore.ts'), 'utf8');
  const originSource = authSource.slice(authSource.indexOf('export function getOAuthOrigin'), authSource.indexOf('export function getOAuthErrorMessage'));
  const originCode = ts.transpileModule(originSource, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
    .replace('export function', 'function').replaceAll('import.meta.env', 'environment');
  for (const [development, hostname, origin, expected] of [
    [true, 'localhost', 'http://localhost:5173', 'http://localhost:5173'],
    [true, '192.168.1.20', 'http://192.168.1.20:5173', 'http://192.168.1.20:5173'],
    [false, '127.0.0.1', 'http://127.0.0.1:4173', 'http://127.0.0.1:4173'],
    [false, 'litzone.art', 'https://litzone.art', 'https://litzone.art'],
  ]) {
    assert.equal(vm.runInNewContext(`${originCode}\ngetOAuthOrigin()`, {
      environment: { DEV: development, VITE_OAUTH_ORIGIN: 'https://litzone.art' },
      window: { location: { hostname, origin } }, PRODUCTION_OAUTH_ORIGIN: 'https://litzone.art',
    }), expected);
  }

  // 运行真实数据库模块，但替换连接构造器，远程地址必须在任何连接构造前被拒绝。
  const storeCode = storeSource.replace(/^import .*;\r?\n/gm, '').replace('export async function', 'async function');
  for (const [host, allowed] of [[undefined, true], ['127.0.0.1', true], ['::1', true], ['db', true], ['qingyu-local-db', true], ['host.docker.internal', true], ['43.160.249.6', false], ['litzone.art', false], ['172.19.0.2', false], ['db.evil.invalid', false]]) {
    let connectionHost;
    const env = { NODE_ENV: 'test', ...(host ? { PGHOST: host } : {}) };
    const databaseContext = { crypto, Buffer, process: { env }, Pool: class {
      constructor(options) { connectionHost = options.host; throw new Error('本地假连接已捕获'); }
    } };
    if (allowed) {
      await assert.rejects(vm.runInNewContext(`${storeCode}\ncreatePostgresBillingStore()`, databaseContext), /本地假连接已捕获/);
      assert.equal(connectionHost, host || '127.0.0.1');
    } else {
      assert.throws(() => vm.runInNewContext(storeCode, databaseContext), /PGHOST/);
      assert.equal(connectionHost, undefined);
    }
  }
  const identityGuard = serverSource.slice(serverSource.indexOf('const APPWRITE_INTERNAL_URL ='), serverSource.indexOf('const __dirname ='));
  for (const [target, allowed] of [['http://127.0.0.1:8081/v1', true], ['http://[::1]:8081/v1', true], ['http://appwrite/v1', true], ['http://host.docker.internal:8081/v1', true], ['https://litzone.art/v1', false], ['http://43.160.249.6/v1', false], ['http://localhost@remote.invalid/v1', false]]) {
    const run = () => vm.runInNewContext(identityGuard, { URL, process: { env: { NODE_ENV: 'development', APPWRITE_INTERNAL_URL: target } } });
    if (allowed) assert.doesNotThrow(run); else assert.throws(run, /APPWRITE_INTERNAL_URL/);
  }
  console.log('通过：本地代理和环境文件禁止远程地址；缺失身份服务的 HTTP/WebSocket 明确失败；本地回调、数据库和后端身份服务隔离。');
}

try {
  const serverSource = await readFile(path.join(scriptDirectory, 'api-server.mjs'), 'utf8');
  await Promise.all(['api-server.mjs', 'asset-upload.mjs', 'object-store.mjs', 'admin-password.mjs'].map(file =>
    copyFile(path.join(scriptDirectory, file), path.join(directory, file))));
  await mkdir(path.join(directory, 'api-data'));
  const keys = ['gemini', 'custom-provider'].map((provider, index) => ({
    id: index + 1, name: `内部渠道-${index}`, provider, base_url: `https://private-${index}.invalid/v1`,
    api_key: `private-test-key-${index}`, is_active: 1, model: `upstream-${index}`,
  }));
  const models = keys.map((key, index) => ({
    id: index + 1, displayName: `公开模型-${index}`, capability: 'image', visible: true,
    linkedModels: [{ channelId: key.id, model: key.model, isActive: true }],
  }));
  models.push({ ...models[0], id: 3, visible: false });
  await Promise.all([
    writeFile(path.join(directory, 'api-data/keys.json'), JSON.stringify(keys)),
    writeFile(path.join(directory, 'api-data/models_catalog.json'), JSON.stringify(models)),
    writeFile(path.join(directory, 'api-data/admin.json'), JSON.stringify({
      username: 'security-admin', password: crypto.createHash('sha256').update('test-passwordqingyu_salt_2026').digest('hex'),
    })),
  ]);

  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(directory, 'api-server.mjs')], {
    cwd: directory,
    // 不继承真实数据库、对象存储或其他生产凭据。
    env: { SystemRoot: process.env.SystemRoot, NODE_ENV: 'test', BILLING_STORE: 'file', PORT: String(port), JWT_SECRET: secret },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  stopped = once(child, 'exit');
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`隔离服务启动失败：${output}`);
    try { await fetch(`${base}/api/config/public`); ready = true; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(ready, '隔离服务应能启动');

  // 未登录应返回 401
  const unauthRes = await fetch(`${base}/api/config/public`);
  assert.equal(unauthRes.status, 401, '未登录不能访问模型列表');

  // 签一个 customer JWT 模拟登录
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwtPayload = { sub: 'test-user', role: 'customer', sid: 'test-sid', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + 300 };
  const jwtHeader = b64({ alg: 'HS256', typ: 'JWT' });
  const jwtData = `${jwtHeader}.${b64(jwtPayload)}`;
  const jwtSig = crypto.createHmac('sha256', secret).update(jwtData).digest('base64url');
  const customerToken = `${jwtData}.${jwtSig}`;

  // 带 cookie 但没暗号头应返回 403
  const noClientRes = await fetch(`${base}/api/config/public`, { headers: { Cookie: `qingyu_session=${customerToken}` } });
  assert.equal(noClientRes.status, 403, '非自家前端请求不能访问模型列表');

  // 带 cookie + 暗号头应正常返回
  const response = await fetch(`${base}/api/config/public`, {
    headers: { Cookie: `qingyu_session=${customerToken}`, 'X-Qingyu-Client': 'web' },
  });
  assert.ok(response.ok, `登录后应正常返回模型列表，实际 ${response.status}`);
  const catalog = await response.json();
  assert.equal(catalog.length, 2, '隐藏模型不能公开');
  for (const [index, entry] of catalog.entries()) {
    assert.deepEqual(Object.keys(entry).sort(), ['base_url', 'id', 'model', 'models', 'name', 'provider']);
    assert.equal(entry.name, `公开模型-${index}`);
    assert.equal(entry.model, `catalog:${index + 1}`);
    assert.equal(entry.provider, index === 0 ? 'gemini' : 'openai');
    assert.equal(entry.base_url, index === 0 ? 'https://generativelanguage.googleapis.com' : 'https://api.openai.com');
  }
  assert.doesNotMatch(JSON.stringify(catalog), /private-|内部渠道|upstream-/);

  // 执行数据库分支的真实公开投影，以假查询结果避免连接生产数据库。
  const storeSource = await readFile(path.join(scriptDirectory, 'postgres-billing-store.mjs'), 'utf8');
  await verifyLocalIsolation(serverSource, storeSource);
  const projection = storeSource.slice(storeSource.indexOf('  async function listPublicModelCatalogChannels()'), storeSource.indexOf('  async function listPlatformModelRoutes('));
  assert.ok(projection.includes('return models.map'));
  const databaseCatalog = await vm.runInNewContext(`${projection}\nlistPublicModelCatalogChannels()`, {
    pool: { query: async () => ({ rows: keys.map((key, index) => ({
      ...key, display_name: `公开模型-${index}`, capability: 'image',
    })) }) },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(databaseCatalog)), catalog, '主分支与备用分支公开字段应保持一致');

  for (const [token, expected] of [
    ['', 401], ['invalid-token', 401],
    [signToken({ sub: 'security-admin' }), 403],
    [signToken({ sub: 'customer', role: 'customer' }), 403],
    [signToken({ sub: 'security-admin', role: 'admin' }), 200],
  ]) {
    const result = await fetch(`${base}/api/admin/models-catalog`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    assert.equal(result.status, expected, '管理入口必须明确要求管理员角色');
  }

  async function login(username, password, extraHeaders = {}) {
    return fetch(`${base}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify({ username, password }),
    });
  }
  assert.equal((await login('security-admin', 'wrong')).status, 401);
  assert.equal((await login('security-admin', 'test-password')).status, 200, '正常登录仍可用');
  const attempts = await Promise.all(Array.from({ length: 12 }, (_, index) => login('security-admin', 'wrong', {
    'X-Forwarded-For': `192.0.2.${index}`, 'CF-Connecting-IP': `192.0.2.${index}`,
  })));
  assert.equal(attempts.filter(result => result.status === 401).length, 10);
  assert.equal(attempts.filter(result => result.status === 429).length, 2, '并发和伪造代理头不能绕过限速');
  assert.ok(Number(attempts.find(result => result.status === 429).headers.get('Retry-After')) > 0);
  assert.match(serverSource, /await postgresBilling\.reserveAdminLoginAttempt\(body\.username\)/, '生产 PostgreSQL 模式必须使用持久化限速');
  assert.match(serverSource, /await postgresBilling\.clearAdminLoginAttempts\(body\.username\)/, '成功登录必须清除持久化失败次数');
  assert.equal((await login('other-admin', 'wrong')).status, 401, '不同账号不共用 Cloudflare 节点限额');
  assert.equal((await login({}, 'wrong')).status, 400);
  assert.equal((await login('a'.repeat(64) + '-suffix', 'wrong')).status, 400, '拒绝会被数据库截短的账号，防止附加不同后缀绕过限速');

  // 以可控时间执行同一限速函数，验证到期恢复和内存上限，无需等待十五分钟。
  const limiterSource = serverSource.slice(serverSource.indexOf('const adminLoginAttempts = new Map();'), serverSource.indexOf('function maskKey('));
  const limiter = vm.runInNewContext(`${limiterSource}\nreserveAdminLoginAttempt`, { crypto });
  for (let index = 0; index < 10; index++) assert.equal(limiter('Admin', 1000).retryAfter, 0);
  assert.equal(limiter(' admin ', 1000).retryAfter, 900);
  assert.equal(limiter('admin', 901000).retryAfter, 0, '到期后恢复尝试');
  for (let index = 0; index < 4095; index++) limiter(`account-${index}`, 901000);
  assert.equal(limiter('overflow', 901000).retryAfter, 60);
  assert.equal(limiter('overflow', 1801000).retryAfter, 0, '过期记录应释放容量');

  // 实际执行 listen 调用，记录指定地址，避免读取主机上的其他服务。
  let binding;
  const listenExpression = serverSource.match(/server\.listen\([^\n]+/)[0];
  const hostDeclaration = serverSource.match(/^const API_HOST = .+;$/m)[0];
  for (const [env, expectedHost] of [
    [{ NODE_ENV: 'test' }, '127.0.0.1'],
    [{ NODE_ENV: 'development', API_HOST: '0.0.0.0' }, '0.0.0.0'],
    [{ NODE_ENV: 'production', API_HOST: '0.0.0.0' }, '127.0.0.1'],
  ]) {
    vm.runInNewContext(`${hostDeclaration}\n${listenExpression}\n});`, {
      process: { env }, PORT: port, server: { listen: (...args) => { binding = args; } },
    });
    assert.equal(binding[1], expectedHost);
  }
  const developmentCompose = yaml.load(await readFile(new URL('../../docker-compose.dev.yml', import.meta.url), 'utf8'));
  const developmentApi = Object.values(developmentCompose.services).find(service => service.environment?.PORT === '3001');
  assert.equal(developmentApi.environment.API_HOST, '0.0.0.0');
  assert.ok(developmentApi.ports.includes('127.0.0.1:3001:3001'), '容器放开监听不能连带开放宿主机公网端口');

  const workflow = yaml.load(await readFile(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8'));
  const steps = workflow.jobs.deploy.steps;
  const frontend = steps.find(step => step.name === 'Deploy to server via SSH').with;
  const config = steps.find(step => step.name === 'Upload Nginx configuration').with;
  assert.notEqual(frontend.target, config.target);
  assert.ok(frontend.target.endsWith('/frontend') && config.target.endsWith('/config'));
  assert.equal(config.strip_components, 2);
  const deployScript = steps.find(step => step.name === 'Reload Nginx').with.script;
  assert.ok(deployScript.includes('cp -a "$deploy_root/frontend/."'));
  assert.ok(deployScript.includes('127.0.0.1:8081:80'));
  assert.ok(!deployScript.includes('- "8081:80"'));
  // Git 路径以仓库根为基准核实，避免子目录 pathspec 漏查。
  const projectRoot = path.resolve(scriptDirectory, '../..');
  const rootTrackedKey = spawnSync('git', ['-C', projectRoot, 'ls-files', '--', 'github_actions_deploy'], { cwd: projectRoot, encoding: 'utf8' });
  assert.equal(rootTrackedKey.status, 0, `无法从仓库根目录检查私钥跟踪状态：${rootTrackedKey.stderr}`);
  assert.equal(rootTrackedKey.stdout.trim(), '', '私钥不能留在 Git 跟踪记录中');

  if (process.argv.includes('--nginx')) {
    const nginxSource = await readFile(path.join(scriptDirectory, 'nginx-qingyu-web.conf'), 'utf8');
    for (const legacyScript of ['step_nginx.sh', 'step_nginx_api.sh']) {
      const legacySource = await readFile(path.join(scriptDirectory, legacyScript), 'utf8');
      assert.ok(legacySource.includes('location = /console { return 301 /console/; }'), `${legacyScript} 必须兼容不带尾斜杠的控制台地址`);
      assert.ok(legacySource.includes('rewrite ^/console/(.*)$ /$1 break;'), `${legacyScript} 必须把控制台入口转发到上游根路径`);
      assert.ok(legacySource.includes("sub_filter_once off;"), `${legacyScript} 必须改写页面中的全部静态资源链接`);
    }
    await mkdir(path.join(directory, 'www/.well-known/acme-challenge'), { recursive: true });
    await mkdir(path.join(directory, 'www/assets'));
    await mkdir(path.join(directory, 'appwrite/assets'), { recursive: true });
    await mkdir(path.join(directory, 'www/scripts/deploy'), { recursive: true });
    await Promise.all([
      writeFile(path.join(directory, 'www/index.html'), '正常页面'),
      writeFile(path.join(directory, 'www/assets/app.js'), '正常资源'),
      writeFile(path.join(directory, 'www/.well-known/acme-challenge/probe'), '证书验证'),
      writeFile(path.join(directory, 'appwrite/index.html'), '<!doctype html><html><head><link rel="stylesheet" href="/assets/index.css"><link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><script src="/assets/index.js"></script></head><body><img src="/logo.svg"></body></html>'),
      writeFile(path.join(directory, 'appwrite/assets/index.css'), 'APPWRITE_CONSOLE_CSS'),
      writeFile(path.join(directory, 'appwrite/assets/index.js'), 'APPWRITE_CONSOLE_JS'),
      writeFile(path.join(directory, 'appwrite/logo.svg'), '<svg>APPWRITE_CONSOLE_LOGO</svg>'),
      writeFile(path.join(directory, 'appwrite/favicon.ico'), 'APPWRITE_CONSOLE_FAVICON'),
      writeFile(path.join(directory, 'appwrite/apple-touch-icon.png'), 'APPWRITE_CONSOLE_TOUCH_ICON'),
      ...['nginx-qingyu-web.conf', '.env', 'github_actions_deploy', 'scripts/deploy/nginx-qingyu-web.conf'].map(file =>
        writeFile(path.join(directory, 'www', file), '不应被下载的测试内容')),
    ]);
    const nginxConfig = nginxSource.replaceAll('/var/www/qingyu-web', '/test/www')
      .replaceAll('/etc/letsencrypt/live/litzone.art/fullchain.pem', '/test/cert.pem')
      .replaceAll('/etc/letsencrypt/live/litzone.art/privkey.pem', '/test/key.pem');
    await writeFile(path.join(directory, 'nginx.conf'), `events {}\nhttp { include /etc/nginx/mime.types; access_log off; ${nginxConfig}
server {
  listen 8081;
  root /test/appwrite;
  index index.html;
  location /v1/ { default_type application/json; return 200 '{"version":"mock-appwrite"}'; }
}
server {
  listen 3001;
  location / { default_type text/plain; return 200 'mock-qingyu-api'; }
}
}`);
    await writeFile(path.join(directory, 'run.sh'), `set -eu
apk add --no-cache openssl curl >/dev/null
openssl req -x509 -newkey rsa:2048 -nodes -keyout /test/key.pem -out /test/cert.pem -days 1 -subj /CN=localhost >/dev/null 2>&1
nginx -t -c /test/nginx.conf
nginx -c /test/nginx.conf
for protocol in http https; do
  for target in nginx-qingyu-web.conf .env github_actions_deploy scripts/deploy/nginx-qingyu-web.conf; do
    status=$(curl -ks -o /dev/null -w '%{http_code}' "$protocol://127.0.0.1/$target")
    test "$status" = 404
  done
  for target in / /assets/app.js /.well-known/acme-challenge/probe; do
    status=$(curl -ks -o /dev/null -w '%{http_code}' "$protocol://127.0.0.1$target")
    test "$status" = 200
  done
  curl -ks -o /test/site-assets.js "$protocol://127.0.0.1/assets/app.js"
  grep -q '正常资源' /test/site-assets.js
  status=$(curl -ks -o /dev/null -w '%{http_code}' "$protocol://127.0.0.1/console")
  test "$status" = 301
  curl -ks -D /test/console-headers -o /test/console.html "$protocol://127.0.0.1/console/"
  grep -q 'href="/console/assets/index.css"' /test/console.html
  grep -q 'src="/console/assets/index.js"' /test/console.html
  grep -q 'href="/console/favicon.ico"' /test/console.html
  grep -q 'href="/console/apple-touch-icon.png"' /test/console.html
  grep -q 'src="/console/logo.svg"' /test/console.html
  status=$(curl -ks -o /test/console.css -w '%{http_code}|%{content_type}' "$protocol://127.0.0.1/console/assets/index.css")
  test "$status" = '200|text/css'
  grep -q 'APPWRITE_CONSOLE_CSS' /test/console.css
  status=$(curl -ks -o /test/console.js -w '%{http_code}' "$protocol://127.0.0.1/console/assets/index.js")
  test "$status" = 200
  grep -q 'APPWRITE_CONSOLE_JS' /test/console.js
  status=$(curl -ks -o /test/console-logo.svg -w '%{http_code}' "$protocol://127.0.0.1/console/logo.svg")
  test "$status" = 200
  grep -q 'APPWRITE_CONSOLE_LOGO' /test/console-logo.svg
  status=$(curl -ks -o /test/console-favicon.ico -w '%{http_code}' "$protocol://127.0.0.1/console/favicon.ico")
  test "$status" = 200
  grep -q 'APPWRITE_CONSOLE_FAVICON' /test/console-favicon.ico
  status=$(curl -ks -o /test/console-touch-icon.png -w '%{http_code}' "$protocol://127.0.0.1/console/apple-touch-icon.png")
  test "$status" = 200
  grep -q 'APPWRITE_CONSOLE_TOUCH_ICON' /test/console-touch-icon.png
  status=$(curl -ks -o /test/api-config -w '%{http_code}' "$protocol://127.0.0.1/api/config/public")
  test "$status" = 200
  grep -q 'mock-qingyu-api' /test/api-config
  status=$(curl -ks -o /test/appwrite-health -w '%{http_code}' "$protocol://127.0.0.1/v1/health/version")
  test "$status" = 200
  grep -q 'mock-appwrite' /test/appwrite-health
  status=$(head -c 9000 /dev/zero | curl -ks -o /dev/null -w '%{http_code}' --data-binary @- "$protocol://127.0.0.1/api/admin/login")
  test "$status" = 413
done
nginx -s quit -c /test/nginx.conf
echo '通过：HTTP/HTTPS 敏感文件拒绝、主站与 API、Appwrite 页面和资源路由、证书验证及登录请求体限制。'
`);
    const docker = spawnSync('docker', ['run', '--rm', '--mount', `type=bind,source=${directory},target=/test`, '--entrypoint', 'sh', 'nginx:alpine', '/test/run.sh'], {
      cwd: scriptDirectory, encoding: 'utf8', timeout: 180000,
    });
    process.stdout.write(docker.stdout || '');
    process.stderr.write(docker.stderr || '');
    assert.equal(docker.status, 0, docker.error?.message || 'Nginx 实际配置与请求验收必须通过');
  }
  const loginRateLimitTest = spawnSync(process.execPath, ['--test', path.join(scriptDirectory, 'test-admin-login-rate-limit.mjs')], {
    cwd: scriptDirectory, encoding: 'utf8', timeout: 30000,
  });
  process.stdout.write(loginRateLimitTest.stdout || '');
  process.stderr.write(loginRateLimitTest.stderr || '');
  assert.equal(loginRateLimitTest.status, 0, loginRateLimitTest.error?.message || '管理员登录持久化限速回归测试必须通过');
  console.log('通过：公开字段、管理员角色、并发登录限速与恢复、本机监听、部署目录隔离和私钥停止跟踪。');
} finally {
  if (child && child.exitCode === null) { child.kill(); await stopped; }
  // 清理前确认最终绝对路径仍在项目的测试目录内。
  const relative = path.relative(scriptDirectory, path.resolve(directory));
  assert.ok(relative.startsWith('.security-test-') && !relative.includes(path.sep));
  await rm(directory, { recursive: true, force: true });
}
