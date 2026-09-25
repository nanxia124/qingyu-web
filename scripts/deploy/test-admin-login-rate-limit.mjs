import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createPostgresBillingStore } from './postgres-billing-store.mjs';

const scriptDirectory = new URL('.', import.meta.url);

function createRateLimitPool() {
  const rows = new Map();
  const statements = [];
  let now = Date.UTC(2026, 0, 1);
  let lockTail = Promise.resolve();
  async function runQuery(sql, values = []) {
    statements.push({ sql, values });
    if (sql === 'select 1') return { rows: [{ '?column?': 1 }], rowCount: 1 };
    if (sql.includes('delete from app.admin_login_attempt_limits') && sql.includes('where account_key in')) {
      let removed = 0;
      for (const [key, record] of rows) {
        if (record.windowStartedAt < now - 24 * 60 * 60 * 1000 && removed < 100) {
          rows.delete(key);
          removed += 1;
        }
      }
      return { rows: [], rowCount: removed };
    }
    if (/select account_key from app\.admin_login_attempt_limits where account_key=\$1/i.test(sql)) {
      return rows.has(values[0])
        ? { rows: [{ account_key: values[0] }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (/select count\(\*\)::integer as count from app\.admin_login_attempt_limits/i.test(sql)) {
      return { rows: [{ count: rows.size }], rowCount: 1 };
    }
    if (sql.includes('insert into app.admin_login_attempt_limits')) {
      assert.match(sql, /on conflict\(account_key\) do update/i, '并发计数必须由 PostgreSQL 唯一键冲突更新串行化');
      assert.match(sql, /least\(app\.admin_login_attempt_limits\.attempt_count \+ 1,11\)/i, '超限后计数不得继续增长');
      const [key] = values;
      assert.match(key, /^[a-f0-9]{64}$/, '数据库只接收账号摘要');
      const current = rows.get(key);
      const expired = current && current.windowStartedAt <= now - 15 * 60 * 1000;
      const next = !current || expired
        ? { attemptCount: 1, windowStartedAt: now }
        : { attemptCount: Math.min(current.attemptCount + 1, 11), windowStartedAt: current.windowStartedAt };
      rows.set(key, next);
      return {
        rows: [{
          attempt_count: next.attemptCount,
          retry_after: Math.max(1, Math.ceil((next.windowStartedAt + 15 * 60 * 1000 - now) / 1000)),
        }],
        rowCount: 1,
      };
    }
    if (sql.includes('delete from app.admin_login_attempt_limits where account_key=$1')) {
      const deleted = rows.delete(values[0]);
      return { rows: [], rowCount: Number(deleted) };
    }
    throw new Error(`测试遇到未预期的数据库语句：${sql}`);
  }
  return {
    rows,
    statements,
    advanceTime(milliseconds) { now += milliseconds; },
    query: runQuery,
    async connect() {
      let unlock;
      return {
        async query(sql, values = []) {
          if (sql === 'begin') return { rows: [], rowCount: null };
          if (sql === 'select pg_advisory_xact_lock(70420260924)') {
            const previous = lockTail;
            lockTail = new Promise(resolve => { unlock = resolve; });
            await previous;
            return { rows: [{ pg_advisory_xact_lock: null }], rowCount: 1 };
          }
          if (sql === 'commit' || sql === 'rollback') {
            unlock?.();
            unlock = null;
            return { rows: [], rowCount: null };
          }
          return runQuery(sql, values);
        },
        release() { unlock?.(); },
      };
    },
    async end() {},
  };
}

test('生产登录限速并发安全、跨 store 重启保留，登录成功清除且窗口到期恢复', async () => {
  const pool = createRateLimitPool();
  const firstStore = await createPostgresBillingStore({ pool });
  const results = await Promise.all(Array.from({ length: 12 }, () => firstStore.reserveAdminLoginAttempt(' Admin ')));

  assert.equal(results.filter(result => result.retryAfter === 0).length, 10);
  assert.equal(results.filter(result => result.retryAfter > 0).length, 2);
  assert.equal(pool.rows.size, 1, '大小写和首尾空格不同的账号形式应落到同一条限速记录');
  assert.equal([...pool.rows.keys()][0], crypto.createHash('sha256').update('admin').digest('hex'));
  assert.ok(pool.statements.filter(statement => statement.sql.includes('insert into app.admin_login_attempt_limits'))
    .every(statement => !statement.values.includes(' Admin ')), '原始账号不得传入数据库');

  await firstStore.close();
  const restartedStore = await createPostgresBillingStore({ pool });
  assert.ok((await restartedStore.reserveAdminLoginAttempt('admin')).retryAfter > 0, '创建新的 API store 实例后限速依旧生效');
  assert.equal(await restartedStore.clearAdminLoginAttempts('ADMIN'), true);
  assert.equal((await restartedStore.reserveAdminLoginAttempt('admin')).retryAfter, 0, '成功登录清理后重新允许尝试');

  pool.advanceTime(16 * 60 * 1000);
  assert.equal((await restartedStore.reserveAdminLoginAttempt('admin')).retryAfter, 0, '15 分钟窗口到期后恢复');
  await restartedStore.close();
});

test('近期账号摘要达到 4096 条时拒绝新账号，但原有账号仍可正常核验', async () => {
  const pool = createRateLimitPool();
  const knownKey = crypto.createHash('sha256').update('admin').digest('hex');
  for (let index = 0; index < 4096; index += 1) {
    const key = index === 0 ? knownKey : index.toString(16).padStart(64, '0');
    pool.rows.set(key, { attemptCount: 1, windowStartedAt: Date.UTC(2026, 0, 1) });
  }
  const store = await createPostgresBillingStore({ pool });
  assert.equal((await store.reserveAdminLoginAttempt('admin')).retryAfter, 0, '已有管理员账号在容量保护时仍可登录');
  assert.equal((await store.reserveAdminLoginAttempt('new-random-account')).retryAfter, 60, '达到容量上限后拒绝新账号');
  assert.equal(pool.rows.size, 4096, '记录数不得超过容量上限');
  await store.close();
});

test('迁移清单包含登录限速表，后台登录 PostgreSQL 分支使用持久化限速', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../database/migrations/MANIFEST.sha256.json', scriptDirectory), 'utf8'));
  const migrationBytes = await readFile(new URL('../../database/migrations/0066_admin_login_attempt_limits.sql', scriptDirectory));
  const migration = migrationBytes.toString('utf8');
  const apiServer = await readFile(new URL('./api-server.mjs', scriptDirectory), 'utf8');
  assert.equal(manifest['0066_admin_login_attempt_limits.sql'], crypto.createHash('sha256').update(migrationBytes).digest('hex'));
  assert.match(migration, /account_key char\(64\) PRIMARY KEY/i);
  assert.match(migration, /REVOKE ALL ON app\.admin_login_attempt_limits FROM qingyu_app/i);
  assert.match(apiServer, /await postgresBilling\.reserveAdminLoginAttempt\(body\.username\)/);
  assert.match(apiServer, /await postgresBilling\.clearAdminLoginAttempts\(body\.username\)/);
});
