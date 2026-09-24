import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { createPostgresBillingStore } from './postgres-billing-store.mjs';

assert.match(process.env.PGDATABASE || '', /^qingyu_payment_event_verify$/);
const pool = new Pool(); const store = await createPostgresBillingStore();
try {
  const id = crypto.randomUUID();
  const event = { eventId: `evt-${id}`, type: 'payment.succeeded', amountMinor: 2900, currency: 'CNY' };
  const first = await store.recordPaymentEvent('test-provider', event);
  const duplicate = await store.recordPaymentEvent('test-provider', event);
  assert.equal(first.duplicate, false); assert.equal(duplicate.duplicate, true); assert.equal(first.eventId, duplicate.eventId);
  await assert.rejects(store.recordPaymentEvent('test-provider', { eventId: 'evt-bad', type: 'payment.succeeded', amountMinor: -1 }), /金额无效/);
  assert.equal(Number((await pool.query(`select count(*) from app.payment_events`)).rows[0].count), 1);
  console.log('PASS: 支付事件签名后入库、事件幂等、金额校验');
} finally { await store.close(); await pool.end(); }
