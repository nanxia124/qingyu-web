import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { createPostgresBillingStore } from './postgres-billing-store.mjs';

assert.match(process.env.PGDATABASE || '', /^qingyu_payment_event_processing_verify$/);
const pool = new Pool();
const store = await createPostgresBillingStore();
const uid = `payment-processing-test-${crypto.randomUUID()}`;
try {
  await store.ensureUser(uid, 'payment-processing@example.invalid');
  const first = await store.createOrder(uid, 'pro', `payment-processing-${crypto.randomUUID()}`);
  const processed = await store.recordPaymentEvent('test-provider', {
    eventId: `event-${crypto.randomUUID()}`,
    type: 'payment.succeeded',
    orderId: first.id,
    amountMinor: first.amountCents,
    currency: 'CNY',
    providerPaymentId: `provider-payment-${crypto.randomUUID()}`,
  });
  assert.equal(processed.status, 'processed', JSON.stringify(processed));
  assert.equal((await pool.query('select status from app.orders where id=$1', [first.id])).rows[0].status, 'paid');
  assert.equal(Number((await pool.query('select count(*) from app.payments where order_id=$1 and status=\'succeeded\'', [first.id])).rows[0].count), 1);
  const firstEventId = processed.eventId;
  const duplicate = await store.recordPaymentEvent('test-provider', JSON.parse(JSON.stringify({
    eventId: processed.providerEventId,
    type: 'payment.succeeded',
    orderId: first.id,
    amountMinor: first.amountCents,
    currency: 'CNY',
  })));
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.status, 'processed');

  const secondCollection = await store.recordPaymentEvent('test-provider', {
    eventId: `event-second-collection-${crypto.randomUUID()}`,
    type: 'payment.succeeded',
    orderId: first.id,
    amountMinor: first.amountCents,
    currency: 'CNY',
    providerPaymentId: `provider-payment-second-${crypto.randomUUID()}`,
  });
  assert.equal(secondCollection.status, 'processed', JSON.stringify(secondCollection));
  assert.equal(secondCollection.duplicateCollection, true);
  assert.equal(Number((await pool.query('select count(*) from app.payments where order_id=$1 and status=\'succeeded\'', [first.id])).rows[0].count), 2);
  assert.equal(Number((await pool.query("select count(*) from app.quota_ledger where idempotency_key=$1", [`grant:order:${first.id}`])).rows[0].count), 1);
  assert.equal(Number((await pool.query("select count(*) from app.platform_alerts where alert_type='payment_duplicate_collection' and detail->>'order_id'=$1", [first.id])).rows[0].count), 1);
  const duplicateRefund = await pool.query("select refund_kind,status,payment_id from app.refunds where idempotency_key=$1", [`duplicate-payment:${secondCollection.paymentId}`]);
  assert.equal(duplicateRefund.rows[0].refund_kind, 'duplicate_collection');
  assert.equal(duplicateRefund.rows[0].status, 'pending');
  assert.equal(duplicateRefund.rows[0].payment_id, secondCollection.paymentId);

  // 把原成功通知置为到期失败，验证重复投递和后台 worker 都能安全补处理。
  await pool.query("update app.payment_events set status='failed',next_retry_at=now() where id=$1", [firstEventId]);
  const retriedDuplicate = await store.recordPaymentEvent('test-provider', {
    eventId: processed.providerEventId,
    type: 'payment.succeeded',
    orderId: first.id,
    amountMinor: first.amountCents,
    currency: 'CNY',
    providerPaymentId: `provider-payment-${crypto.randomUUID()}`,
  });
  assert.equal(retriedDuplicate.duplicate, true);
  assert.equal(retriedDuplicate.status, 'processed');
  await pool.query("update app.payment_events set status='failed',next_retry_at=now() where id=$1", [firstEventId]);
  const recovered = await store.processRecoverablePaymentEvents(20);
  assert.ok(recovered.claimed >= 1);
  assert.equal((await pool.query('select status from app.payment_events where id=$1', [firstEventId])).rows[0].status, 'processed');
  assert.equal(Number((await pool.query('select count(*) from app.payments where order_id=$1 and status=\'succeeded\'', [first.id])).rows[0].count), 2);
  assert.equal(Number((await pool.query("select count(*) from app.quota_ledger where idempotency_key=$1", [`grant:order:${first.id}`])).rows[0].count), 1);

  const mismatch = await store.createOrder(uid, 'pro', `payment-mismatch-${crypto.randomUUID()}`);
  const bad = await store.recordPaymentEvent('test-provider', { eventId: `bad-${crypto.randomUUID()}`, type: 'payment.succeeded', orderId: mismatch.id, amountMinor: first.amountCents + 1, currency: 'CNY' });
  assert.equal(bad.status, 'review');
  assert.equal((await pool.query('select status from app.orders where id=$1', [mismatch.id])).rows[0].status, 'pending');
  const mismatchedReceipt = await pool.query(`select p.amount_minor,p.currency,e.payment_id from app.payments p join app.payment_events e on e.payment_id=p.id where e.id=$1`, [bad.eventId]);
  assert.equal(Number(mismatchedReceipt.rows[0].amount_minor), first.amountCents + 1);
  assert.equal(mismatchedReceipt.rows[0].currency, 'CNY');
  assert.ok(mismatchedReceipt.rows[0].payment_id);
  await pool.query("update app.orders set status='cancelled',updated_at=now() where id=$1", [mismatch.id]);

  const collision = await store.createOrder(uid, 'pro', `payment-collision-${crypto.randomUUID()}`);
  const collisionResult = await store.recordPaymentEvent('test-provider', { eventId: `collision-${crypto.randomUUID()}`, type: 'payment.succeeded', orderId: collision.id, amountMinor: collision.amountCents, currency: 'CNY', providerPaymentId: 'provider-payment-collision' });
  assert.equal(collisionResult.status, 'processed');
  const collisionAgain = await store.createOrder(uid, 'pro', `payment-collision-2-${crypto.randomUUID()}`);
  const collisionRejected = await store.recordPaymentEvent('test-provider', { eventId: `collision-2-${crypto.randomUUID()}`, type: 'payment.succeeded', orderId: collisionAgain.id, amountMinor: collisionAgain.amountCents, currency: 'CNY', providerPaymentId: 'provider-payment-collision' });
  assert.equal(collisionRejected.status, 'review');
  assert.equal((await pool.query('select status from app.orders where id=$1', [collisionAgain.id])).rows[0].status, 'pending');
  console.log('PASS: 支付通知重试、多笔实收留痕、重复发权益防护、金额异常转人工核对、交易号串单拒绝');
} finally {
  await store.close();
  await pool.end();
}
