import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  createAdminPasswordHash,
  isAdminPasswordHash,
  needsAdminPasswordRehash,
  verifyAdminPassword,
} from './admin-password.mjs';
import { createPostgresBillingStore } from './postgres-billing-store.mjs';

const legacySalt = 'qingyu_salt_2026';
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

async function getAvailablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForApi(child, port) {
  let logs = '';
  child.stdout.on('data', chunk => { logs = `${logs}${chunk}`.slice(-4000); });
  child.stderr.on('data', chunk => { logs = `${logs}${chunk}`.slice(-4000); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`本地 API 提前退出：${logs}`);
    try {
      await fetch(`http://127.0.0.1:${port}/api/config/public`);
      return;
    } catch { /* API 尚未开始监听 */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`本地 API 在限定时间内没有就绪：${logs}`);
}

test('新密码使用独立随机盐保存，可验证且符合数据库字段长度', async () => {
  const first = await createAdminPasswordHash('secure-test-password');
  const second = await createAdminPasswordHash('secure-test-password');

  assert.notEqual(first, second);
  assert.ok(first.startsWith('scrypt$1$16384$8$5$'));
  assert.ok(first.length <= 128);
  assert.ok(isAdminPasswordHash(first));
  assert.equal(await verifyAdminPassword('secure-test-password', first), true);
  assert.equal(await verifyAdminPassword('wrong-password', first), false);
  assert.equal(needsAdminPasswordRehash(first), false);
});

test('旧版固定盐密码仍可验证，并标记为登录后升级', async () => {
  const legacyHash = crypto.createHash('sha256').update('legacy-test-password' + legacySalt).digest('hex');

  assert.ok(isAdminPasswordHash(legacyHash));
  assert.equal(await verifyAdminPassword('legacy-test-password', legacyHash), true);
  assert.equal(await verifyAdminPassword('wrong-password', legacyHash), false);
  assert.equal(needsAdminPasswordRehash(legacyHash), true);
});

test('畸形或不支持的密码格式会被拒绝', async () => {
  for (const value of ['', 'scrypt$99$16384$8$1$abc$def', 'scrypt$1$999999$8$1$abc$def', 'not-a-hash']) {
    assert.equal(isAdminPasswordHash(value), false);
    assert.equal(await verifyAdminPassword('any-password', value), false);
  }
  assert.equal(await verifyAdminPassword(null, await createAdminPasswordHash('valid-password')), false);
});

test('数据库只在密码仍匹配旧值时升级，迟到的并发升级不会覆盖新密码', async () => {
  const legacyHash = crypto.createHash('sha256').update('legacy-test-password' + legacySalt).digest('hex');
  let storedHash = legacyHash;
  const fakePool = {
    async query(sql, values = []) {
      if (sql === 'select 1') return { rows: [{ '?column?': 1 }], rowCount: 1 };
      if (sql.includes('insert into app.admin_accounts')) {
        if (!storedHash) storedHash = values[1];
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('select username,password_hash,status,last_login_at from app.admin_accounts')) {
        return storedHash
          ? { rows: [{ username: values[0], password_hash: storedHash, status: 'active', last_login_at: null }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes('update app.admin_accounts set password_hash=$3')) {
        if (storedHash !== values[1]) return { rows: [], rowCount: 0 };
        storedHash = values[2];
        return { rows: [{ username: values[0] }], rowCount: 1 };
      }
      throw new Error(`测试遇到未预期的数据库语句：${sql}`);
    },
    async end() {},
  };
  const store = await createPostgresBillingStore({ pool: fakePool });
  const firstUpgrade = await createAdminPasswordHash('legacy-test-password');
  const lateUpgrade = await createAdminPasswordHash('legacy-test-password');

  assert.ok(isAdminPasswordHash(firstUpgrade));
  await assert.doesNotReject(store.ensureAdminAccount('admin-test', firstUpgrade));
  assert.equal(await store.upgradeAdminPasswordHash('admin-test', legacyHash, firstUpgrade), true);
  assert.equal(await store.upgradeAdminPasswordHash('admin-test', legacyHash, lateUpgrade), false);
  assert.equal(storedHash, firstUpgrade);
  assert.equal(await verifyAdminPassword('legacy-test-password', storedHash), true);
  await store.close();
});

test('文件存储模式不读取旧管理员文件，也不允许管理员登录', async () => {
  const testDirectory = fs.mkdtempSync(path.join(scriptDirectory, '.admin-password-test-'));
  const deployDirectory = path.resolve(scriptDirectory);
  const resolvedTestDirectory = path.resolve(testDirectory);
  assert.ok(resolvedTestDirectory.startsWith(`${deployDirectory}${path.sep}`), '测试目录必须位于 scripts/deploy 内');

  const oldPassword = 'legacy-admin-test-password';
  const newPassword = 'new-admin-test-password';
  const legacyHash = crypto.createHash('sha256').update(oldPassword + legacySalt).digest('hex');
  const adminDataDirectory = path.join(testDirectory, 'api-data');
  fs.mkdirSync(adminDataDirectory, { recursive: true });
  fs.writeFileSync(path.join(adminDataDirectory, 'admin.json'), JSON.stringify({ username: 'migration-test', password: legacyHash }), { mode: 0o600 });
  for (const file of ['api-server.mjs', 'asset-upload.mjs', 'object-store.mjs', 'admin-password.mjs']) {
    fs.copyFileSync(path.join(scriptDirectory, file), path.join(testDirectory, file));
  }

  const port = await getAvailablePort();
  const child = spawn(process.execPath, [path.join(testDirectory, 'api-server.mjs')], {
    cwd: testDirectory,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      BILLING_STORE: 'file',
      PORT: String(port),
      API_HOST: '127.0.0.1',
      JWT_SECRET: 'isolated-admin-password-test-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output = `${output}${chunk}`.slice(-4000); });
  child.stderr.on('data', chunk => { output = `${output}${chunk}`.slice(-4000); });

  try {
    await waitForApi(child, port);
    const endpoint = `http://127.0.0.1:${port}/api/admin/login`;
    const login = async password => fetch(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'migration-test', password }),
    });

    const firstLogin = await login(oldPassword);
    assert.equal(firstLogin.status, 503, '文件存储模式必须拒绝管理员登录');
    const storedAfterUpgrade = JSON.parse(fs.readFileSync(path.join(adminDataDirectory, 'admin.json'), 'utf8')).password;
    assert.equal(storedAfterUpgrade, legacyHash, '文件模式不得读取或升级磁盘上的管理员密码');
    assert.equal((await login(newPassword)).status, 503);
  } catch (error) {
    error.message = `${error.message}\n${output}`;
    throw error;
  } finally {
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
    }
    if (child.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(resolvedTestDirectory, { recursive: true, force: true });
  }
});
