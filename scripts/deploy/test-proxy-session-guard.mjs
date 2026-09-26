import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtemp, copyFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const directory = await mkdtemp(path.join(scriptDirectory, '.qingyu-proxy-session-test-'));
const listener = net.createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const base = `http://127.0.0.1:${port}`;
const secret = 'isolated-proxy-session-test-secret';
let child;
let stopped;
let childOutput = '';

function signToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const content = `${header}.${body}`;
  const signature = createHmac('sha256', secret).update(content).digest('base64url');
  return `${content}.${signature}`;
}

async function start() {
  child = spawn(process.execPath, [path.join(directory, 'api-server.mjs')], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      BILLING_STORE: 'file',
      PORT: String(port),
      JWT_SECRET: secret,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  childOutput = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { childOutput += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { childOutput += chunk; });
  stopped = once(child, 'exit');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`临时服务启动失败：\n${childOutput}`);
    try { await fetch(`${base}/api/config/public`); return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`临时服务启动超时：\n${childOutput}`);
}

async function stop() {
  if (child && child.exitCode === null) {
    child.kill();
    await stopped;
  }
  child = undefined;
}

async function assertProductionStartRejected(jwtSecret, reason) {
  const env = { ...process.env, NODE_ENV: 'production', BILLING_STORE: 'file', PORT: String(port) };
  delete env.JWT_SECRET;
  if (jwtSecret !== undefined) env.JWT_SECRET = jwtSecret;
  const candidate = spawn(process.execPath, [path.join(directory, 'api-server.mjs')], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  candidate.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
  candidate.stderr.setEncoding('utf8').on('data', chunk => { output += chunk; });
  const ended = once(candidate, 'exit').then(([code, signal]) => ({ code, signal }));
  const outcome = await Promise.race([ended, new Promise(resolve => setTimeout(() => resolve(null), 2000))]);
  if (!outcome) {
    candidate.kill();
    await ended;
    assert.fail(`生产环境使用${reason}时，服务不应启动`);
  }
  assert.equal(outcome.code, 1, `生产环境使用${reason}时应以错误码 1 拒绝启动`);
  assert.match(output, /JWT_SECRET/, `拒绝原因应明确指出需要配置 JWT_SECRET：${output}`);
}

async function assertProductionFileStorageRejected(jwtSecret) {
  const candidate = spawn(process.execPath, [path.join(directory, 'api-server.mjs')], {
    env: { ...process.env, NODE_ENV: 'production', BILLING_STORE: 'file', PORT: String(port), JWT_SECRET: jwtSecret },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  candidate.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
  candidate.stderr.setEncoding('utf8').on('data', chunk => { output += chunk; });
  const ended = once(candidate, 'exit').then(([code, signal]) => ({ code, signal }));
  try {
    const outcome = await Promise.race([ended, new Promise(resolve => setTimeout(() => resolve(null), 2000))]);
    assert.ok(outcome, `生产环境文件存储未及时拒绝启动：\n${output}`);
    assert.equal(outcome.code, 1, `生产环境必须拒绝文件存储：\n${output}`);
    assert.match(output, /PostgreSQL/, `拒绝原因应说明生产环境需要数据库存储：\n${output}`);
  } finally {
    if (candidate.exitCode === null) {
      candidate.kill();
      await ended;
    }
  }
}

async function proxyRequest(token, origin = base) {
  const response = await fetch(`${base}/api/proxy/openai/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      ...(token ? { Cookie: `qingyu_session=${token}` } : {}),
    },
    body: JSON.stringify({ model: `unused-${randomUUID()}`, messages: [] }),
  });
  return { status: response.status, body: await response.json() };
}

try {
  await Promise.all([
    copyFile(new URL('./api-server.mjs', import.meta.url), path.join(directory, 'api-server.mjs')),
    copyFile(new URL('./asset-upload.mjs', import.meta.url), path.join(directory, 'asset-upload.mjs')),
    copyFile(new URL('./object-store.mjs', import.meta.url), path.join(directory, 'object-store.mjs')),
    copyFile(new URL('./admin-password.mjs', import.meta.url), path.join(directory, 'admin-password.mjs')),
  ]);
  await assertProductionStartRejected(undefined, '缺少 JWT_SECRET');
  await assertProductionStartRejected('qingyu-api-jwt-secret-2026-change-me', '公开默认 JWT_SECRET');
  await assertProductionFileStorageRejected('isolated-production-secret-with-sufficient-entropy-2026');
  const systemdServiceInstaller = await readFile(new URL('./step_systemd.sh', import.meta.url), 'utf8');
  assert.match(systemdServiceInstaller, /^EnvironmentFile=\/etc\/qingyu-api\.env$/m, 'systemd 必须加载部署文档指定的 API 环境配置');
  await start();

  const unauthenticated = await proxyRequest('');
  assert.equal(unauthenticated.status, 401, '没有登录票必须拒绝');

  const legacyToken = signToken({
    sub: 'isolated-legacy-device',
    role: 'customer',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  const legacyResponse = await proxyRequest(legacyToken);
  assert.equal(legacyResponse.status, 401, '没有设备会话编号的旧版登录票必须拒绝');
  const legacyHeaderResponse = await fetch(`${base}/api/proxy/openai/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base, 'X-Qingyu-Billing-Token': signToken({ sub: 'legacy', role: 'customer', sid: randomUUID(), exp: Math.floor(Date.now() / 1000) + 300 }) },
    body: JSON.stringify({ model: 'unused-legacy', messages: [] }),
  });
  assert.equal(legacyHeaderResponse.status, 401, '旧的自定义用户身份请求头必须拒绝');

  const sessionToken = signToken({
    sub: 'isolated-current-device',
    role: 'customer',
    sid: randomUUID(),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  const unavailableResponse = await proxyRequest(sessionToken);
  assert.equal(unavailableResponse.status, 503, '数据库不可用时不得绕过计费与会话检查调用上游');
  const crossOriginResponse = await proxyRequest(sessionToken, 'https://untrusted.example');
  assert.equal(crossOriginResponse.status, 403, '跨站页面不能借用 Cookie 发起 AI 请求');
  const queryTokenResponse = await fetch(`${base}/api/generation-tasks/${randomUUID()}/outputs/0/content?token=${encodeURIComponent(sessionToken)}`);
  assert.equal(queryTokenResponse.status, 401, '图片结果接口不能用 URL 查询参数里的登录票鉴权');

  console.log('通过：生产环境缺少或使用公开默认 JWT_SECRET 时拒绝启动；生产文件存储拒绝启动；Cookie 会话及旧 Bearer/自定义头/URL 登录票拒绝；跨站写入拒绝；无计费数据库时 AI 代理关闭。');
} finally {
  await stop();
  await rm(directory, { recursive: true, force: true });
}
