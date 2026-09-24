// 只允许在命名隔离测试库运行；测试夹具通过删除临时库清理。
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { createPostgresBillingStore } from './postgres-billing-store.mjs';

assert.match(process.env.PGDATABASE || '', /^qingyu_reconciliation_verify$/);
const pool = new Pool();
const store = await createPostgresBillingStore();
try {
  const u = (await pool.query(`insert into app.user_accounts(appwrite_user_id) values($1) returning id`, [`verify-${crypto.randomUUID()}`])).rows[0].id;
  const w = (await pool.query(`insert into app.workspaces(type,owner_user_id,name) values('personal',$1,'并发核对测试') returning id`, [u])).rows[0].id;
  const q = (await pool.query(`insert into app.quota_accounts(workspace_id,quota_code,granted,reserved) values($1,'monthly',10,1) returning id`, [w])).rows[0].id;
  const r = (await pool.query(`insert into app.quota_reservations(account_id,workspace_id,quota_code,amount,idempotency_key,expires_at)
    values($1,$2,'monthly',1,$3,now()-interval '1 minute') returning id`, [q,w,crypto.randomUUID()])).rows[0].id;
  const usage = (await pool.query(`insert into app.usage_records(workspace_id,user_id,feature_code,quantity,unit,result,idempotency_key,quota_reservation_id)
    values($1,$2,'ai_proxy',1,'request','unknown',$3,$4) returning id`, [w,u,crypto.randomUUID(),r])).rows[0].id;
  const input = { decision: 'committed', reason: '核对并发测试', providerReference: 'test-provider-reference' };
  const result = await Promise.all(Array.from({ length: 10 }, () => store.adminReconcileUsage(usage,'test-admin',input)));
  assert.equal(new Set(result.map(x => x.reconciliationId)).size,1);
  await assert.rejects(store.adminReconcileUsage(usage,'test-admin',{...input,decision:'released'}), /已有核对结论/);
  const balance = (await pool.query(`select reserved,consumed from app.quota_accounts where id=$1`, [q])).rows[0];
  assert.equal(Number(balance.reserved),0);
  assert.equal(Number(balance.consumed),1);
  assert.equal(Number((await pool.query(`select count(*) from app.quota_ledger where reservation_id=$1`, [r])).rows[0].count),1);
  assert.equal((await store.adminUnknownUsage()).some(x=>x.id===usage),false);
  console.log('PASS: 10 次服务层并发核对只结算一次，冲突结论拒绝，已处理记录退出待核对列表');
} finally { await store.close(); await pool.end(); }
