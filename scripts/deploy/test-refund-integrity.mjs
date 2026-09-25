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
  const duplicateCollection = await store.recordPaymentEvent('test-provider', {
    eventId: `refund-duplicate-event-${crypto.randomUUID()}`,
    type: 'payment.succeeded',
    orderId: order.id,
    amountMinor: order.amountCents,
    currency: 'CNY',
    providerPaymentId: `refund-duplicate-payment-${crypto.randomUUID()}`,
  });
  assert.equal(duplicateCollection.duplicateCollection, true);
  const automaticRefund = (await pool.query("select id,payment_id,refund_kind,status from app.refunds where idempotency_key=$1", [`duplicate-payment:${duplicateCollection.paymentId}`])).rows[0];
  assert.equal(automaticRefund.refund_kind, 'duplicate_collection');
  assert.equal(automaticRefund.status, 'pending');
  const first = await store.createRefundRequest(uid, { orderId: order.id, amountCents: 1000, reason: '测试部分退款', idempotencyKey: 'refund-key-1' });
  assert.equal(first.paymentId === automaticRefund.payment_id, false);
  assert.equal(first.refundKind, 'purchase_refund');
  assert.equal((await store.createRefundRequest(uid, { orderId: order.id, amountCents: 1000, reason: '重复请求', idempotencyKey: 'refund-key-1' })).id, first.id);
  await assert.rejects(store.createRefundRequest(uid, { orderId: order.id, amountCents: 3000, reason: '超额退款', idempotencyKey: 'refund-key-2' }), /超过可退金额/);
  const refundScope = (await pool.query('select workspace_id,order_id,payment_id,currency from app.refunds where id=$1', [first.id])).rows[0];
  await assert.rejects(
    pool.query(`insert into app.refunds(workspace_id,order_id,payment_id,amount_minor,currency,idempotency_key,reason,requested_by)
      values($1,$2,$3,$4,$5,$6,'直接写库超额退款',(select id from app.user_accounts where appwrite_user_id=$7))`,
      [refundScope.workspace_id, refundScope.order_id, refundScope.payment_id, 3000, refundScope.currency, 'refund-direct-over-limit', uid]),
    /对应收款的退款累计金额超过已收金额|单笔退款金额超过对应收款金额/
  );
  await store.adminUpdateRefund(first.id, { status: 'succeeded', providerRefundId: 'provider-refund-1' });
  let orderRow = (await pool.query('select status from app.orders where id=$1', [order.id])).rows[0];
  assert.equal(orderRow.status, 'partially_refunded');
  const second = await store.createRefundRequest(uid, { orderId: order.id, amountCents: 1900, reason: '测试剩余退款', idempotencyKey: 'refund-key-3' });
  await store.adminUpdateRefund(second.id, { status: 'succeeded', providerRefundId: 'provider-refund-2' });
  orderRow = (await pool.query('select status from app.orders where id=$1', [order.id])).rows[0];
  assert.equal(orderRow.status, 'partially_refunded');
  await store.adminUpdateRefund(automaticRefund.id, { status: 'succeeded', providerRefundId: 'provider-refund-duplicate' });
  orderRow = (await pool.query('select status from app.orders where id=$1', [order.id])).rows[0];
  assert.equal(orderRow.status, 'refunded');
  const lateCollection = await store.recordPaymentEvent('test-provider', {
    eventId: `refund-late-collection-event-${crypto.randomUUID()}`,
    type: 'payment.succeeded',
    orderId: order.id,
    amountMinor: order.amountCents,
    currency: 'CNY',
    providerPaymentId: `refund-late-collection-${crypto.randomUUID()}`,
  });
  assert.equal(lateCollection.duplicateCollection, true);
  orderRow = (await pool.query('select status from app.orders where id=$1', [order.id])).rows[0];
  assert.equal(orderRow.status, 'partially_refunded');
  const lateRefund = (await pool.query("select id from app.refunds where idempotency_key=$1", [`duplicate-payment:${lateCollection.paymentId}`])).rows[0];
  await store.adminUpdateRefund(lateRefund.id, { status: 'succeeded', providerRefundId: 'provider-refund-late-duplicate' });
  orderRow = (await pool.query('select status from app.orders where id=$1', [order.id])).rows[0];
  assert.equal(orderRow.status, 'refunded');
  console.log('PASS: 退款幂等、重复收款自动建退款、逐笔实收退款上限和订单状态收敛');
} finally { await store.close(); await pool.end(); }
