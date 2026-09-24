import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { createPostgresBillingStore } from './postgres-billing-store.mjs';

assert.match(process.env.PGDATABASE || '', /^qingyu_order_verify$/);
const pool = new Pool();
const store = await createPostgresBillingStore();
const uid = `order-test-${crypto.randomUUID()}`;
try {
  await store.ensureUser(uid, 'order-test@example.invalid');
  const key = `order-key-${crypto.randomUUID()}`;
  const results = await Promise.all(Array.from({ length: 10 }, () => store.createOrder(uid, 'pro', key)));
  assert.equal(new Set(results.map(x => x.id)).size, 1);
  assert.equal((await store.createOrder(uid, 'pro', key)).id, results[0].id);
  await assert.rejects(store.createOrder(uid, 'team', key), /幂等键已用于其他套餐/);
  const count = (await pool.query(`select count(*) from app.orders o join app.workspaces w on w.id=o.workspace_id join app.user_accounts u on u.id=w.owner_user_id where u.appwrite_user_id=$1`, [uid])).rows[0].count;
  assert.equal(Number(count), 1);
  console.log('PASS: PostgreSQL 订单并发幂等、重复重试复用、同键换套餐拒绝');
} finally { await store.close(); await pool.end(); }
