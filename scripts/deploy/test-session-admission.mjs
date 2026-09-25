import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { createPostgresBillingStore } from './postgres-billing-store.mjs';

assert.equal(process.env.PGDATABASE, 'qingyu_session_verify', '测试只允许连接隔离数据库 qingyu_session_verify');

const pool = new Pool();
const store = await createPostgresBillingStore();
const userId = `session-admission-${crypto.randomUUID()}`;
const deviceIds = Array.from({ length: 9 }, () => crypto.randomUUID());

function deviceInfo(installationId) {
  return {
    installationId,
    providerSessionId: `session-admission-${crypto.randomUUID()}`,
    displayName: '测试设备',
    clientType: 'test',
    osFamily: 'test',
    browserFamily: 'test',
  };
}

async function activeSessions() {
  const sessions = await store.listSessions(userId);
  return sessions.filter((session) => session.status === 'active' && Date.parse(session.expiresAt) > Date.now());
}

try {
  await store.ensureUser(userId, 'session-admission@example.invalid');
  assert.equal(await store.isSessionActive(userId, ''), false, '缺少会话编号必须拒绝，不能把旧版登录票视为有效');

  const first = await store.registerSession(userId, deviceInfo(deviceIds[0]));
  const second = await store.registerSession(userId, deviceInfo(deviceIds[1]));
  assert.equal(await store.isSessionActive(userId, first.id), false, '离线设备会话不能调用受保护接口');
  assert.equal(await store.isSessionAdmitted(userId, first.id), true, '仍有效的离线设备可进入设备管理');
  assert.equal(await store.isSessionActive(userId, second.id), true, '当前在线设备会话应保持有效');
  assert.equal(await store.isSessionAdmitted(userId, second.id), true, '在线设备会话应可进入设备管理');
  let active = await activeSessions();
  assert.equal(active.length, 2);
  assert.equal(active.filter((session) => session.online).length, 1);
  assert.equal(active.find((session) => session.installationId === deviceIds[0]).online, false);
  assert.equal(active.find((session) => session.installationId === deviceIds[1]).online, true);

  const reused = await store.registerSession(userId, deviceInfo(deviceIds[1]));
  assert.equal(reused.id, second.id, '同一浏览器重新登记应复用有效会话');
  assert.equal((await activeSessions()).filter((session) => session.online).length, 1);

  const switched = await store.registerSession(userId, deviceInfo(deviceIds[0]));
  assert.equal(switched.id, first.id, '明确切换回已有设备应复用该设备会话');
  active = await activeSessions();
  assert.equal(active.filter((session) => session.online).length, 1);
  assert.equal(active.find((session) => session.installationId === deviceIds[0]).online, true);
  assert.equal(active.find((session) => session.installationId === deviceIds[1]).online, false);

  for (let index = 2; index < 4; index += 1) {
    await store.registerSession(userId, deviceInfo(deviceIds[index]));
  }
  active = await activeSessions();
  assert.equal(active.length, 3, '超过上限时仍只能保留三台有效设备');
  assert.equal(active.filter((session) => session.online).length, 1, '超过上限后仍只能有一台在线');
  const allSessions = await store.listSessions(userId);
  assert.equal(allSessions.find((session) => session.installationId === deviceIds[0]).status, 'revoked', '满额后最早的设备应被撤销');
  assert.equal(await store.isSessionActive(userId, first.id), false, '被撤销的会话必须失效');
  assert.equal(await store.isSessionAdmitted(userId, first.id), false, '被撤销的设备不能用旧票管理其他设备');

  await Promise.all(deviceIds.slice(4).map((installationId) => store.registerSession(userId, deviceInfo(installationId))));
  active = await activeSessions();
  assert.ok(active.length <= 3, '并发登录不能突破三台设备上限');
  assert.equal(active.filter((session) => session.online).length, 1, '并发登录完成后只能有一台在线');

  console.log('通过：设备会话复用、设备切换、最多三台、单设备在线、并发登录上限。');
} finally {
  await store.close();
  await pool.end();
}
