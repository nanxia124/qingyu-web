import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { createPostgresBillingStore } from './postgres-billing-store.mjs';

assert.match(process.env.PGDATABASE || '', /^qingyu_refund_verify$/);
const pool = new Pool();
const store = await createPostgresBillingStore();
const uid = `refund-test-${crypto.randomUUID()}`;
try {
  await store.ensureUser(uid, 'refund-test@example.invalid');
  const order = await store.createOrder(uid, 'pro', `refund-order-${crypto.randomUUID()}`);
  await store.payOrder(uid, order.id);
  const first = await store.createRefundRequest(uid, { orderId: order.id, amountCents: 1000, reason: '测试部分退款', idempotencyKey: 'refund-key-1' });
  assert.equal((await store.createRefundRequest(uid, { orderId: order.id, amountCents: 1000, reason: '重复请求', idempotencyKey: 'refund-key-1' })).id, first.id);
  await assert.rejects(store.createRefundRequest(uid, { orderId: order.id, amountCents: 2000, reason: '超额退款', idempotencyKey: 'refund-key-2' }), /超过可退金额/);
  await store.adminUpdateRefund(first.id, { status: 'succeeded', providerRefundId: 'provider-refund-1' });
  let orderRow = (await pool.query('select status from app.orders where id=$1', [order.id])).rows[0];
  assert.equal(orderRow.status, 'partially_refunded');
  const second = await store.createRefundRequest(uid, { orderId: order.id, amountCents: 1900, reason: '测试剩余退款', idempotencyKey: 'refund-key-3' });
  await store.adminUpdateRefund(second.id, { status: 'succeeded', providerRefundId: 'provider-refund-2' });
  orderRow = (await pool.query('select status from app.orders where id=$1', [order.id])).rows[0];
  assert.equal(orderRow.status, 'refunded');
  console.log('PASS: 退款幂等、部分退款、超额拒绝、订单状态收敛');
} finally { await store.close(); await pool.end(); }
