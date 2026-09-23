// 临时目录中的独立模拟服务，不接触线上账本。
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
const directory = await mkdtemp(path.join(tmpdir(), 'qingyu-payment-test-'));
const listener = net.createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const base = `http://127.0.0.1:${port}`;
let child, stopped;
async function start() {
  child = spawn(process.execPath, [path.join(directory, 'api-server.mjs')], {
    env: { ...process.env, PORT: String(port), JWT_SECRET: 'isolated-test-secret' }, stdio: 'ignore',
  });
  stopped = once(child, 'exit');
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('临时服务启动失败');
    try { await fetch(`${base}/api/config/public`); return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('临时服务启动超时');
}
async function stop() {
  if (child && child.exitCode === null) { child.kill(); await stopped; }
  child = undefined;
}
async function request(route, body, token, expected = 200) {
  const response = await fetch(`${base}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(response.status, expected, `接口状态错误：${route}`);
  return data;
}
try {
  await copyFile(new URL('./api-server.mjs', import.meta.url), path.join(directory, 'api-server.mjs'));
  await start();
  const { token } = await request('/api/billing/login', { userId: 'isolated-payment-user' });
  const key = randomUUID(), alias = randomUUID();
  const create = idempotencyKey => request('/api/billing/orders', { planId: 'pro', idempotencyKey }, token);
  const orders = await Promise.all(Array.from({ length: 12 }, () => create(key)));
  assert.ok(orders.every(order => order.id === orders[0].id), '连续点击应只创建一单');
  const orderId = orders[0].id;
  assert.equal((await create(alias)).id, orderId, '另一窗口应复用待付款单');
  await request('/api/billing/orders', { planId: 'team', idempotencyKey: key }, token, 409);
  const before = await request('/api/billing/me', undefined, token);
  const payments = await Promise.all(Array.from({ length: 12 }, () => request(`/api/billing/orders/${orderId}/pay`, {}, token)));
  assert.ok(payments.every(payment => payment.success));
  assert.equal(payments.filter(payment => !payment.alreadyPaid).length, 1, '只能首次发放权益');
  const after = await request('/api/billing/me', undefined, token);
  assert.equal(after.user.balance - before.user.balance, 50000, '额度只能增加一次');
  assert.equal((await create(randomUUID())).id, orderId, '付款后新窗口不能再开通同套餐');
  assert.equal((await create(alias)).id, orderId, '别名也需持久化');
  const ledger = JSON.parse(await readFile(path.join(directory, 'api-data/billing_transactions.json'), 'utf8'));
  assert.equal(ledger.filter(entry => entry.type === 'membership').length, 1);
  await stop(); await start();
  assert.equal((await create(key)).id, orderId, '重启后仍应返回原单');
  const replay = await request(`/api/billing/orders/${orderId}/pay`, {}, token);
  assert.equal(replay.alreadyPaid, true);
  assert.equal(replay.user.balance, after.user.balance);
  const { token: legacy } = await request('/api/billing/login', { userId: 'isolated-legacy-user' });
  const legacyOrder = await request('/api/billing/orders', { planId: 'pro' }, legacy);
  await request(`/api/billing/orders/${legacyOrder.id}/pay`, {}, legacy);
  assert.equal((await request('/api/billing/orders', { planId: 'pro' }, legacy)).id, legacyOrder.id);
  console.log('通过：连续点击、多窗口、参数冲突、权益仅发一次、重启重试、旧客户端兼容。');
} finally {
  await stop();
  // 只清理本脚本通过 mkdtemp 创建的目录。
  await rm(directory, { recursive: true, force: true });
}
