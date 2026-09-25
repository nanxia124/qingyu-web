// 临时目录中的独立模拟服务，不接触线上账本。
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const directory = await mkdtemp(path.join(scriptDirectory, '.qingyu-payment-test-'));
const listener = net.createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const base = `http://127.0.0.1:${port}`;
const appwriteServer = http.createServer((req, res) => {
  const token = String(req.headers['x-appwrite-jwt'] || '');
  if (req.method !== 'GET' || req.url !== '/v1/account' || !token.startsWith('test-jwt-')) {
    res.writeHead(401, { 'Content-Type': 'application/json' }).end('{}');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ $id: token.slice('test-jwt-'.length) }));
});
let appwritePort;
let child, stopped, childOutput = '';
let activeCookie = '';
let lastSetCookieHeader = '';
let lastAllowOrigin = '';
let lastAllowCredentials = '';
async function start() {
  child = spawn(process.execPath, [path.join(directory, 'api-server.mjs')], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      BILLING_STORE: 'file',
      PAYMENT_MODE: 'mock',
      PORT: String(port),
      JWT_SECRET: 'isolated-test-secret',
      APPWRITE_INTERNAL_URL: `http://127.0.0.1:${appwritePort}/v1`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  childOutput = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { childOutput += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { childOutput += chunk; });
  stopped = once(child, 'exit');
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`临时服务启动失败：\n${childOutput}`);
    try { await fetch(`${base}/api/config/public`); return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`临时服务启动超时：\n${childOutput}`);
}
async function stop() {
  if (child && child.exitCode === null) { child.kill(); await stopped; }
  child = undefined;
}
async function request(route, body, cookie = activeCookie, expected = 200, origin = base) {
  const headers = { 'Content-Type': 'application/json', Origin: origin };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${base}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get('set-cookie');
  lastAllowOrigin = response.headers.get('access-control-allow-origin') || '';
  lastAllowCredentials = response.headers.get('access-control-allow-credentials') || '';
  if (setCookie?.startsWith('qingyu_session=')) {
    lastSetCookieHeader = setCookie;
    activeCookie = /(?:^|;\s*)Max-Age=0(?:;|$)/i.test(setCookie) ? '' : setCookie.split(';', 1)[0];
  }
  const data = await response.json();
  assert.equal(response.status, expected, `接口状态错误：${route}`);
  return data;
}
async function login(userId) {
  const data = await request('/api/billing/login', { userId, appwriteJwt: `test-jwt-${userId}` });
  assert.equal(data.token, undefined, '登录票不得返回给网页脚本');
  assert.match(activeCookie, /^qingyu_session=/);
  assert.match(lastSetCookieHeader, /; Path=\/api/);
  assert.match(lastSetCookieHeader, /; HttpOnly/);
  assert.match(lastSetCookieHeader, /; SameSite=Lax/);
  assert.match(lastSetCookieHeader, /; Max-Age=2592000/);
  assert.equal(lastAllowOrigin, base, '允许的网页来源应收到精确匹配的 CORS 来源');
  assert.equal(lastAllowCredentials, 'true', '允许的网页来源应可安全携带登录 Cookie');
  return data;
}
try {
  await new Promise(resolve => appwriteServer.listen(0, '127.0.0.1', resolve));
  appwritePort = appwriteServer.address().port;
  await copyFile(new URL('./api-server.mjs', import.meta.url), path.join(directory, 'api-server.mjs'));
  await copyFile(new URL('./asset-upload.mjs', import.meta.url), path.join(directory, 'asset-upload.mjs'));
  await copyFile(new URL('./object-store.mjs', import.meta.url), path.join(directory, 'object-store.mjs'));
  await start();
  await login('isolated-payment-user');
  assert.ok(activeCookie.includes('qingyu_session='));
  const legacyBearer = activeCookie.slice('qingyu_session='.length);
  const bearerOnly = await fetch(`${base}/api/billing/me`, { headers: { Authorization: `Bearer ${legacyBearer}` } });
  assert.equal(bearerOnly.status, 401, '旧版可读 Bearer 登录票不能继续鉴权');
  await request('/api/billing/me', undefined, '', 401);
  await request('/api/billing/orders', { planId: 'pro', idempotencyKey: randomUUID() }, activeCookie, 403, 'https://untrusted.example');
  const key = randomUUID(), alias = randomUUID();
  const create = idempotencyKey => request('/api/billing/orders', { planId: 'pro', idempotencyKey });
  const orders = await Promise.all(Array.from({ length: 12 }, () => create(key)));
  assert.ok(orders.every(order => order.id === orders[0].id), '连续点击应只创建一单');
  const orderId = orders[0].id;
  assert.equal((await create(alias)).id, orderId, '另一窗口应复用待付款单');
  await request('/api/billing/orders', { planId: 'team', idempotencyKey: key }, undefined, 409);
  const before = await request('/api/billing/me');
  const payments = await Promise.all(Array.from({ length: 12 }, () => request(`/api/billing/orders/${orderId}/pay`, {})));
  assert.ok(payments.every(payment => payment.success));
  assert.equal(payments.filter(payment => !payment.alreadyPaid).length, 1, '只能首次发放权益');
  const after = await request('/api/billing/me');
  assert.equal(after.user.balance - before.user.balance, 50000, '额度只能增加一次');
  assert.equal((await create(key)).id, orderId, '付款后重试原购买编号仍应返回已付订单');
  assert.equal((await create(alias)).id, orderId, '别名也需持久化');
  const renewalOrder = await create(randomUUID());
  assert.notEqual(renewalOrder.id, orderId, '用户主动发起新的续费应创建新购买订单');
  assert.equal(renewalOrder.status, 'pending', '新的续费订单在付款前不能提前发放权益');
  const ledger = JSON.parse(await readFile(path.join(directory, 'api-data/billing_transactions.json'), 'utf8'));
  assert.equal(ledger.filter(entry => entry.type === 'membership').length, 1);
  await stop(); await start();
  assert.equal((await create(key)).id, orderId, '重启后仍应返回原单');
  const replay = await request(`/api/billing/orders/${orderId}/pay`, {});
  assert.equal(replay.alreadyPaid, true);
  assert.equal(replay.user.balance, after.user.balance);
  await request('/api/billing/logout', {});
  assert.equal(activeCookie, '', '登出响应应清除浏览器 Cookie');
  await request('/api/billing/me', undefined, '', 401);
  console.log('通过：HttpOnly Cookie 登录、旧 Bearer 拒绝、跨站写入拒绝、登出清票，以及订单幂等和权益仅发一次。');
} finally {
  await stop();
  if (appwriteServer.listening) await new Promise(resolve => appwriteServer.close(resolve));
  // 只清理本脚本通过 mkdtemp 创建的目录。
  await rm(directory, { recursive: true, force: true });
}
