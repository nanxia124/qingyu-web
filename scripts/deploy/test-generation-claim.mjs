import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { createPostgresBillingStore } from './postgres-billing-store.mjs';

// 只允许在专用验收库运行，防止把测试用户写入正式库。
assert.equal(process.env.PGDATABASE, 'qingyu_generation_verify');
const pool = new Pool();
const store = await createPostgresBillingStore();
const user = `claim-${crypto.randomUUID()}`;
const other = `claim-other-${crypto.randomUUID()}`;
try {
  await store.ensureUser(user, 'claim@example.invalid');
  await store.ensureUser(other, 'other@example.invalid');
  const input = { provider: 'test', model: 'test', prompt: '领取测试', quantity: 1,
    idempotencyKey: `claim:${crypto.randomUUID()}` };
  const tasks = await Promise.all(Array.from({ length: 20 }, () => store.createGenerationTask(user, input)));
  assert.equal(new Set(tasks.map(task => task.id)).size, 1, '重复提交必须返回同一个任务');
  const task = tasks[0];
  await assert.rejects(store.markTaskRunning(other, task.id, null), /无权领取/);
  const claims = await Promise.all(Array.from({ length: 20 }, () => store.markTaskRunning(user, task.id, null)));
  assert.equal(claims.filter(Boolean).length, 1, '20 个并发处理者只能有一个领取成功');
  assert.equal(await store.markTaskRunning(user, task.id, null), false);
  await store.failTask(user, task.id, 'test', '模拟失败', true);
  assert.equal(await store.markTaskRunning(user, task.id, null), false, '终态不能重新领取');
  const row = (await pool.query(`select t.status,r.status reservation_status
    from app.generation_tasks t join app.daily_usage_reservations r on r.id=t.daily_reservation_id
    where t.id=$1`, [task.id])).rows[0];
  assert.equal(row.status, 'refunded');
  assert.equal(row.reservation_status, 'released');
  const expired = await store.createGenerationTask(user, { ...input, idempotencyKey: `expired:${crypto.randomUUID()}` });
  await pool.query(`update app.generation_tasks set timeout_at=now()-interval '1 second' where id=$1`, [expired.id]);
  assert.equal(await store.markTaskRunning(user, expired.id, null), false, '过期任务不能发起新调用');
  const success = await store.createGenerationTask(user, { ...input, idempotencyKey: `success:${crypto.randomUUID()}` });
  assert.equal(await store.markTaskRunning(user, success.id, null), true);
  const settled = await store.settleTaskSuccess(user, success.id, [{ type: 'image', url: 'https://example.invalid/test.png' }], 'test-ref');
  assert.equal(settled.status, 'succeeded');
  assert.equal(settled.outputs.length, 1);
  assert.equal(await store.markTaskRunning(user, success.id, null), false);
  console.log('PASS：20 次并发提交、20 次并发领取、跨用户拒绝、终态拒绝、过期拒绝与额度释放');
} finally {
  await store.close();
  await pool.end();
}
