import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPostgresBillingStore } from './postgres-billing-store.mjs';

const userId = '00000000-0000-4000-8000-000000000001';
const appwriteUserId = 'asset-lifecycle-test-user';
const workspaceId = '00000000-0000-4000-8000-000000000002';
const assetId = '00000000-0000-4000-8000-000000000003';

class FakePool {
  constructor({ status = 'active', accessible = true } = {}) {
    this.assetStatus = status;
    this.accessible = accessible;
    this.statements = [];
    this.events = [];
    this.version = 1;
  }

  async query(sql) {
    assert.match(sql, /select 1/i);
    return { rowCount: 1, rows: [{ '?column?': 1 }] };
  }

  async connect() {
    return {
      query: async (sql, params = []) => {
        this.statements.push({ sql, params });
        if (/^select id from app\.user_accounts/i.test(sql)) return { rowCount: 1, rows: [{ id: userId }] };
        if (/^select set_config/i.test(sql)) return { rowCount: 1, rows: [] };
        if (/^select a\.id,a\.workspace_id,a\.status,a\.title/i.test(sql)) {
          if (!this.accessible || params[0] !== assetId || !['active', 'deleted'].includes(this.assetStatus)) return { rowCount: 0, rows: [] };
          return { rowCount: 1, rows: [{ id: assetId, workspace_id: workspaceId, status: this.assetStatus, title: '测试素材' }] };
        }
        if (/^update app\.assets set status=/i.test(sql)) {
          this.assetStatus = params[1];
          this.version += 1;
          return { rowCount: 1, rows: [] };
        }
        if (/^insert into app\.outbox_events/i.test(sql)) {
          this.events.push(params[0]);
          return { rowCount: 1, rows: [] };
        }
        if (/^select a\.id,a\.title/i.test(sql) && /from app\.assets a where a\.status=\$4/i.test(sql)) {
          const status = params[3];
          if (status !== this.assetStatus) return { rowCount: 0, rows: [] };
          return { rowCount: 1, rows: [assetListRow(this.assetStatus)] };
        }
        if (/^select a\.title,f\.storage_provider/i.test(sql)) {
          assert.match(sql, /a\.status in \('active','deleted'\)/);
          return { rowCount: 1, rows: [{ title: '测试素材', storage_provider: 'cos', bucket: 'test-bucket', object_key: 'workspaces/test/file.png', mime_type: 'image/png', size_bytes: '4', checksum: 'abcd' }] };
        }
        if (/^(begin|commit|rollback)$/i.test(sql.trim())) return { rowCount: 0, rows: [] };
        throw new Error(`未预期的测试 SQL: ${sql}`);
      },
      release: () => {},
    };
  }

  async end() {}
}

function assetListRow(status) {
  return {
    id: assetId, title: '测试素材', asset_type: 'image', visibility: 'private', status,
    deleted_at: status === 'deleted' ? new Date('2026-09-25T00:00:00.000Z') : null,
    created_at: new Date('2026-09-24T00:00:00.000Z'), updated_at: new Date('2026-09-25T00:00:00.000Z'),
    like_count: 0, comment_count: 0, is_liked: false, is_favorite: false, metadata: {},
  };
}

async function makeStore(pool) {
  const store = await createPostgresBillingStore({ pool });
  return { store, close: () => store.close() };
}

test('删除只把素材移入回收站并发出同步事件，不删除 COS 文件', async () => {
  const pool = new FakePool();
  const { store, close } = await makeStore(pool);
  try {
    assert.deepEqual(await store.deleteAsset(appwriteUserId, assetId), { id: assetId, status: 'deleted' });
    assert.equal(pool.assetStatus, 'deleted');
    assert.deepEqual(pool.events, ['asset.deleted']);
    assert.equal(pool.statements.some(({ sql }) => /delete from app\.(assets|asset_files|file_objects)|update app\.file_objects/i.test(sql)), false);
  } finally { await close(); }
});

test('重复删除不会重复增加版本或重复发同步事件', async () => {
  const pool = new FakePool({ status: 'deleted' });
  const { store, close } = await makeStore(pool);
  try {
    assert.deepEqual(await store.deleteAsset(appwriteUserId, assetId), { id: assetId, status: 'deleted' });
    assert.equal(pool.version, 1);
    assert.deepEqual(pool.events, []);
  } finally { await close(); }
});

test('恢复回收站素材会重新显示素材并发出同步事件', async () => {
  const pool = new FakePool({ status: 'deleted' });
  const { store, close } = await makeStore(pool);
  try {
    assert.deepEqual(await store.restoreAsset(appwriteUserId, assetId), { id: assetId, status: 'active' });
    assert.equal(pool.assetStatus, 'active');
    const update = pool.statements.find(({ sql }) => /^update app\.assets set status=/i.test(sql));
    assert.equal(update.params[2], null);
    assert.deepEqual(pool.events, ['asset.restored']);
  } finally { await close(); }
});

test('无管理权限的用户不能删除素材', async () => {
  const pool = new FakePool({ accessible: false });
  const { store, close } = await makeStore(pool);
  try {
    await assert.rejects(store.deleteAsset(appwriteUserId, assetId), error => error.status === 404);
    assert.equal(pool.assetStatus, 'active');
    assert.deepEqual(pool.events, []);
    assert.equal(pool.statements.some(({ sql }) => /^rollback$/i.test(sql.trim())), true);
  } finally { await close(); }
});

test('回收站筛选只返回已删除记录并提供删除时间', async () => {
  const pool = new FakePool({ status: 'deleted' });
  const { store, close } = await makeStore(pool);
  try {
    const items = await store.listAssets(appwriteUserId, 'all', '', 'deleted');
    assert.equal(items.length, 1);
    assert.equal(items[0].status, 'deleted');
    assert.equal(items[0].deletedAt, '2026-09-25T00:00:00.000Z');
  } finally { await close(); }
});

test('素材移入回收站后画布仍可读取 COS 原文件', async () => {
  const pool = new FakePool({ status: 'deleted' });
  const { store, close } = await makeStore(pool);
  try {
    const file = await store.getAssetFile(appwriteUserId, assetId);
    assert.equal(file.storageProvider, 'cos');
    assert.equal(file.objectKey, 'workspaces/test/file.png');
    assert.equal(file.sizeBytes, 4);
  } finally { await close(); }
});
