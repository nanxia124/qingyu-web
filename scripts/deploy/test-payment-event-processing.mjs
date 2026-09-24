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
  assert.equal(processed.status, 'processed');
  assert.equal((await pool.query('select status from app.orders where id=$1', [first.id])).rows[0].status, 'paid');
  assert.equal(Number((await pool.query('select count(*) from app.payments where order_id=$1 and status=\'succeeded\'', [first.id])).rows[0].count), 1);
  const duplicate = await store.recordPaymentEvent('test-provider', JSON.parse(JSON.stringify({
    eventId: processed.providerEventId,
    type: 'payment.succeeded',
    orderId: first.id,
    amountMinor: first.amountCents,
    currency: 'CNY',
  })));
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.status, 'processed');

  const mismatch = await store.createOrder(uid, 'pro', `payment-mismatch-${crypto.randomUUID()}`);
  const bad = await store.recordPaymentEvent('test-provider', { eventId: `bad-${crypto.randomUUID()}`, type: 'payment.succeeded', orderId: mismatch.id, amountMinor: first.amountCents + 1, currency: 'CNY' });
  assert.equal(bad.status, 'failed');
  assert.equal((await pool.query('select status from app.orders where id=$1', [mismatch.id])).rows[0].status, 'pending');
  await pool.query("update app.orders set status='cancelled',updated_at=now() where id=$1", [mismatch.id]);

  const collision = await store.createOrder(uid, 'pro', `payment-collision-${crypto.randomUUID()}`);
  const collisionResult = await store.recordPaymentEvent('test-provider', { eventId: `collision-${crypto.randomUUID()}`, type: 'payment.succeeded', orderId: collision.id, amountMinor: collision.amountCents, currency: 'CNY', providerPaymentId: 'provider-payment-collision' });
  assert.equal(collisionResult.status, 'processed');
  const collisionAgain = await store.createOrder(uid, 'pro', `payment-collision-2-${crypto.randomUUID()}`);
  const collisionRejected = await store.recordPaymentEvent('test-provider', { eventId: `collision-2-${crypto.randomUUID()}`, type: 'payment.succeeded', orderId: collisionAgain.id, amountMinor: collisionAgain.amountCents, currency: 'CNY', providerPaymentId: 'provider-payment-collision' });
  assert.equal(collisionRejected.status, 'failed');
  assert.equal((await pool.query('select status from app.orders where id=$1', [collisionAgain.id])).rows[0].status, 'pending');
  console.log('PASS: 支付事件自动入账、重复回调幂等、金额不符拒绝、交易号串单拒绝');
} finally {
  await store.close();
  await pool.end();
}
