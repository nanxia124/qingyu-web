import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { createPostgresBillingStore } from './postgres-billing-store.mjs';

assert.match(process.env.PGDATABASE || '', /^qingyu_invoice_verify$/);
const pool = new Pool();
const store = await createPostgresBillingStore();
const uid = `invoice-test-${crypto.randomUUID()}`;
try {
  await store.ensureUser(uid, 'invoice-test@example.invalid');
  const order = await store.createOrder(uid, 'pro', `invoice-order-${crypto.randomUUID()}`);
  await assert.rejects(
    store.createInvoiceRequest(uid, { titleType: 'personal', titleName: '测试抬头', email: 'invoice-test@example.invalid', orderIds: [order.id] }),
    /所选订单不存在或不可开票/
  );
  await store.payOrder(uid, order.id);
  const applied = await store.createInvoiceRequest(uid, { titleType: 'personal', titleName: '测试抬头', email: 'invoice-test@example.invalid', orderIds: [order.id] });
  assert.equal(applied.status, 'pending');
  await assert.rejects(
    store.createInvoiceRequest(uid, { titleType: 'personal', titleName: '重复抬头', email: 'invoice-test@example.invalid', orderIds: [order.id] }),
    /已有部分申请过发票/
  );
  const rows = await store.listMyInvoiceRequests(uid);
  assert.equal(rows.length, 1);
  console.log('PASS: 未支付订单禁止开票，已支付订单只能申请一次，用户可以读取自己的发票记录');
} finally {
  await store.close();
  await pool.end();
}
