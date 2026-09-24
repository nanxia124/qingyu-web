import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createPostgresBillingStore } from './postgres-billing-store.mjs';

assert.match(process.env.PGDATABASE || '', /^qingyu_quota_audit_verify$/);
const store = await createPostgresBillingStore();
const uid = `quota-audit-test-${crypto.randomUUID()}`;
try {
  await store.ensureUser(uid, 'quota-audit@example.invalid');
  await store.adminAdjustBalance(uid, 100, '审计测试发放');
  await store.adminAdjustBalance(uid, -10, '审计测试扣减');
  const rows = await store.adminQuotaAudit();
  const account = rows.find(row => row.quotaCode === 'monthly');
  assert.ok(account);
  assert.equal(account.consistent, true);
  assert.equal(account.current.granted, 100);
  assert.equal(account.current.consumed, 10);
  assert.equal(account.differences.granted, 0);
  assert.equal(account.differences.consumed, 0);
  console.log('PASS: 额度账户与不可变流水重算一致，差异只读报告不会覆盖余额');
} finally {
  await store.close();
}
