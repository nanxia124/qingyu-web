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
    from app.generation_tasks t join app.quota_reservations r on r.id=t.quota_reservation_id
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

  const recoverable = await store.createGenerationTask(user, { ...input, idempotencyKey: `recoverable:${crypto.randomUUID()}` });
  assert.equal(await store.markTaskRunning(user, recoverable.id, null), true);
  const recoverableAttempt = await store.beginGenerationAttempt(user, recoverable.id);
  const recoverableSlot = await store.reserveGeneratedOutput(user, recoverable.id, recoverableAttempt.attemptId, 0, {
    bucket: 'generation-verify', recoveryUrl: 'https://provider.example/generated.png?signature=secret-test-value',
  });
  const encryptedSource = (await pool.query(`select recovery_source_ciphertext from app.generation_outputs where id=$1`, [recoverableSlot.outputId])).rows[0].recovery_source_ciphertext;
  assert.ok(encryptedSource);
  assert.equal(encryptedSource.includes('secret-test-value'), false, '恢复地址必须加密保存');
  await pool.query(`update app.file_jobs set next_run_at=now() where generation_output_id=$1`, [recoverableSlot.outputId]);
  await store.completeGenerationAttempt(user, recoverable.id, recoverableAttempt.attemptId, 1, 'provider-ref');
  assert.equal((await store.getGenerationTask(user, recoverable.id)).status, 'saving');
  const worker = `generation-recovery:${crypto.randomUUID()}`;
  const claimed = await store.claimFileUploadRecoveryJobs(worker, 50);
  const recoveryJob = claimed.find(job => job.generationOutputId === recoverableSlot.outputId);
  assert.ok(recoveryJob, '已完成上游响应的输出槽位应进入恢复队列');
  const recoveryContext = await store.getGenerationOutputRecoveryContext(recoveryJob);
  assert.equal(recoveryContext.recoveryUrl, 'https://provider.example/generated.png?signature=secret-test-value');
  const finishedOutput = await store.finishGeneratedOutputRecoveryJob(recoveryJob, {
    sizeBytes: 64, contentType: 'image/png', sha256: 'a'.repeat(64), storageVersionId: 'verify-version',
  });
  const recoveredTask = await store.settleGenerationTaskIfComplete(user, finishedOutput.taskId, 'provider-ref');
  assert.equal(recoveredTask.status, 'succeeded');
  assert.equal(recoveredTask.outputs.length, 1);
  const savedRecovery = (await pool.query(`select o.availability,o.recovery_source_ciphertext,f.status file_status,j.status job_status
    from app.generation_outputs o join app.file_objects f on f.id=o.file_id
    join app.file_jobs j on j.generation_output_id=o.id where o.id=$1`, [recoverableSlot.outputId])).rows[0];
  assert.equal(savedRecovery.availability, 'available');
  assert.equal(savedRecovery.recovery_source_ciphertext, null);
  assert.equal(savedRecovery.file_status, 'ready');
  assert.equal(savedRecovery.job_status, 'succeeded');

  const partial = await store.createGenerationTask(user, { ...input, quantity: 2, idempotencyKey: `partial:${crypto.randomUUID()}` });
  assert.equal(await store.markTaskRunning(user, partial.id, null), true);
  const partialAttempt = await store.beginGenerationAttempt(user, partial.id);
  const goodSlot = await store.reserveGeneratedOutput(user, partial.id, partialAttempt.attemptId, 0, { bucket: 'generation-verify' });
  const badSlot = await store.reserveGeneratedOutput(user, partial.id, partialAttempt.attemptId, 1, { bucket: 'generation-verify' });
  await store.recordGeneratedOutput(user, partial.id, {
    outputId: goodSlot.outputId, fileId: goodSlot.fileId, sizeBytes: 32, contentType: 'image/png', sha256: 'b'.repeat(64),
  });
  await pool.query(`update app.file_jobs set next_run_at=now() where generation_output_id=$1`, [badSlot.outputId]);
  await store.completeGenerationAttempt(user, partial.id, partialAttempt.attemptId, 2, 'provider-ref-partial');
  const partialJobs = await store.claimFileUploadRecoveryJobs(`generation-partial:${crypto.randomUUID()}`, 50);
  const failedJob = partialJobs.find(job => job.generationOutputId === badSlot.outputId);
  assert.ok(failedJob);
  await store.failGeneratedOutputRecoveryJob(failedJob, 'source_unavailable', 1);
  const refundedPartial = await store.getGenerationTask(user, partial.id);
  assert.equal(refundedPartial.status, 'refunded');
  assert.equal(refundedPartial.outputs.length, 1, '失败退款后已保存的那张图片仍要保留');
  assert.equal((await store.listGeneratedOutputs(user, partial.id)).length, 1);
  const partialReservation = (await pool.query(`select r.status from app.quota_reservations r
    join app.generation_tasks t on t.quota_reservation_id=r.id where t.id=$1`, [partial.id])).rows[0];
  assert.equal(partialReservation.status, 'released');
  console.log('PASS：20 次并发提交、20 次并发领取、跨用户拒绝、终态拒绝、过期拒绝与积分预留释放');
} finally {
  await store.close();
  await pool.end();
}
