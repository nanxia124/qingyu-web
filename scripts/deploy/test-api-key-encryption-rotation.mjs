import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const workerMode = process.argv[2] || '';
const TEST_DATABASE = 'qingyu_key_rotation_verify';

if (workerMode.startsWith('--worker-')) {
  const { createPostgresBillingStore } = await import('./postgres-billing-store.mjs');
  const store = await createPostgresBillingStore();
  try {
    const [, , mode, first, second, third, modelId, fourth] = process.argv;
    if (mode === '--worker-seed') {
      const row = await store.createPlatformApiKey({
        name: first,
        provider: 'openai',
        base_url: 'https://provider.invalid/v1',
        api_key: second,
        model: third,
        is_active: 1,
      });
      console.log(JSON.stringify({ id: row.id }));
    } else if (mode === '--worker-verify-and-rotate') {
      const listed = (await store.listPlatformApiKeys()).find(row => row.id === third);
      assert.ok(listed?.api_key_masked, '管理后台列表只应返回掩码密钥');
      assert.equal(Object.hasOwn(listed, 'api_key'), false, '管理后台列表不得返回密钥明文');
      const created = await store.createPlatformApiKey({
        name: fourth,
        provider: 'openai',
        base_url: 'https://provider.invalid/v1',
        api_key: 'new-provider-key-for-rotation-test',
        model: modelId,
        is_active: 1,
      });
      console.log(JSON.stringify({ id: created.id }));
    } else if (mode === '--worker-verify-current-only') {
      const listed = await store.listPlatformApiKeys();
      assert.ok(listed.find(row => row.id === first)?.api_key_masked);
      assert.ok(listed.find(row => row.id === second)?.api_key_masked);
      assert.ok(listed.find(row => row.id === third)?.api_key_masked);
      assert.ok(listed.every(row => !Object.hasOwn(row, 'api_key')), '列表响应中不得包含明文密钥字段');
      console.log('通过：密钥已使用当前加密密钥保存，管理列表不返回明文。');
    } else {
      throw new Error(`未知测试工作模式：${mode}`);
    }
  } finally {
    await store.close();
  }
} else {
  assert.equal(process.env.PGDATABASE, TEST_DATABASE, `测试只允许连接隔离数据库 ${TEST_DATABASE}`);

  const pool = new Pool();
  const suffix = crypto.randomUUID();
  const oldName = `codex-key-rotation-old-${suffix}`;
  const oldListedName = `codex-key-rotation-listed-${suffix}`;
  const newName = `codex-key-rotation-new-${suffix}`;
  const modelId = `codex-key-rotation-model-${suffix}`;
  const secretWithoutApiKey = { ...process.env, NODE_ENV: 'production' };
  delete secretWithoutApiKey.API_KEY_ENCRYPTION_SECRET;
  delete secretWithoutApiKey.API_KEY_ENCRYPTION_PREVIOUS_SECRET;
  try {
    assert.throws(
      () => execFileSync(process.execPath, [scriptPath, '--worker-production-secret-check'], {
        env: secretWithoutApiKey,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      error => String(error.stderr || '').includes('API_KEY_ENCRYPTION_SECRET'),
      '生产 PostgreSQL 服务必须拒绝未配置独立 API Key 加密密钥的启动',
    );

    const seedEnv = {
      ...process.env,
      NODE_ENV: 'test',
      API_KEY_ENCRYPTION_SECRET: 'legacy-jwt-derived-encryption-secret',
      JWT_SECRET: 'legacy-jwt-derived-encryption-secret',
    };
    const seeded = JSON.parse(execFileSync(process.execPath, [scriptPath, '--worker-seed', oldName, 'old-provider-key-for-rotation-test', modelId], {
      env: seedEnv,
      encoding: 'utf8',
    }).trim());
    const seededForList = JSON.parse(execFileSync(process.execPath, [scriptPath, '--worker-seed', oldListedName, 'old-provider-key-for-rotation-test', modelId], {
      env: seedEnv,
      encoding: 'utf8',
    }).trim());
    const beforeRotation = await pool.query('select api_key_ciphertext from app.platform_api_keys where id=$1', [seeded.id]);
    const beforeListRotation = await pool.query('select api_key_ciphertext from app.platform_api_keys where id=$1', [seededForList.id]);
    assert.equal(beforeRotation.rowCount, 1);
    assert.equal(beforeListRotation.rowCount, 1);
    const oldCiphertext = beforeRotation.rows[0].api_key_ciphertext;
    const oldListCiphertext = beforeListRotation.rows[0].api_key_ciphertext;

    const rotatedEnv = {
      ...process.env,
      NODE_ENV: 'test',
      JWT_SECRET: 'new-login-jwt-secret-after-rotation',
      API_KEY_ENCRYPTION_SECRET: 'new-independent-api-encryption-secret',
      API_KEY_ENCRYPTION_PREVIOUS_SECRET: 'legacy-jwt-derived-encryption-secret',
    };
    const withoutPreviousEnv = { ...rotatedEnv };
    delete withoutPreviousEnv.API_KEY_ENCRYPTION_PREVIOUS_SECRET;
    assert.throws(
      () => execFileSync(process.execPath, [scriptPath, '--worker-verify-and-rotate', seeded.id, 'old-provider-key-for-rotation-test', seededForList.id, modelId, newName], {
        env: withoutPreviousEnv,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      error => String(error.stderr || '').includes('密钥解密失败'),
      '旧密钥未配置为过渡密钥时，服务必须明确报解密错误，不能静默损坏密文',
    );
    const created = JSON.parse(execFileSync(process.execPath, [scriptPath, '--worker-verify-and-rotate', seeded.id, 'old-provider-key-for-rotation-test', seededForList.id, modelId, newName], {
      env: rotatedEnv,
      encoding: 'utf8',
    }).trim());
    const afterRotation = await pool.query('select id,name,api_key_ciphertext from app.platform_api_keys where id=any($1::uuid[])', [[seeded.id, seededForList.id, created.id]]);
    assert.equal(afterRotation.rowCount, 3);
    assert.notEqual(afterRotation.rows.find(row => row.id === seeded.id).api_key_ciphertext, oldCiphertext, '读取旧密文时应惰性重加密为当前密钥');
    assert.notEqual(afterRotation.rows.find(row => row.id === seededForList.id).api_key_ciphertext, oldListCiphertext, '列出旧密文时应惰性重加密为当前密钥');

    const currentOnlyEnv = {
      ...process.env,
      NODE_ENV: 'test',
      JWT_SECRET: 'another-login-jwt-secret',
      API_KEY_ENCRYPTION_SECRET: 'new-independent-api-encryption-secret',
    };
    delete currentOnlyEnv.API_KEY_ENCRYPTION_PREVIOUS_SECRET;
    execFileSync(process.execPath, [scriptPath, '--worker-verify-current-only', seeded.id, created.id, seededForList.id], {
      env: currentOnlyEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    console.log('通过：供应商密钥加密与 JWT 分离；配置旧密钥后可读旧密文并自动重加密；撤掉旧密钥后仍可读取。');
  } finally {
    await pool.query('delete from app.platform_api_keys where name = any($1::text[])', [[oldName, oldListedName, newName]]).catch(() => {});
    await pool.query('delete from app.model_catalog where model_id=$1', [modelId]).catch(() => {});
    await pool.end();
  }
}
