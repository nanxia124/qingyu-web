import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { createPostgresBillingStore } from './postgres-billing-store.mjs';

assert.equal(process.env.PGDATABASE, 'qingyu_subscription_renewal_verify');
const pool = new Pool();
const store = await createPostgresBillingStore();
const userId = `subscription-renewal-${crypto.randomUUID()}`;

function addMonth(date, anchorDay) {
  const year = date.getUTCFullYear() + (date.getUTCMonth() === 11 ? 1 : 0);
  const month = (date.getUTCMonth() + 1) % 12;
  const day = Math.min(anchorDay, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
}

try {
  await store.ensureUser(userId, 'subscription-renewal@example.invalid');
  const firstOrder = await store.createOrder(userId, 'pro', `renewal-first-${crypto.randomUUID()}`);
  const firstPayment = await store.recordPaymentEvent('renewal-test-provider', {
    eventId: `renewal-event-${crypto.randomUUID()}`, type: 'payment.succeeded', orderId: firstOrder.id,
    amountMinor: firstOrder.amountCents, currency: 'CNY', providerPaymentId: `renewal-payment-${crypto.randomUUID()}`,
  });
  assert.equal(firstPayment.status, 'processed', JSON.stringify(firstPayment));
  const initial = (await pool.query('select s.id,current_period_start,current_period_end,billing_anchor_day from app.subscriptions s join app.workspaces w on w.id=s.workspace_id join app.user_accounts u on u.id=w.owner_user_id where u.appwrite_user_id=$1', [userId])).rows[0];
  assert.ok(initial);
  assert.equal(new Date(initial.current_period_end).getTime(), addMonth(new Date(initial.current_period_start), Number(initial.billing_anchor_day)).getTime());

  const secondOrder = await store.createOrder(userId, 'pro', `renewal-second-${crypto.randomUUID()}`);
  const secondPayment = await store.recordPaymentEvent('renewal-test-provider', {
    eventId: `renewal-event-${crypto.randomUUID()}`, type: 'payment.succeeded', orderId: secondOrder.id,
    amountMinor: secondOrder.amountCents, currency: 'CNY', providerPaymentId: `renewal-payment-${crypto.randomUUID()}`,
  });
  assert.equal(secondPayment.status, 'processed', JSON.stringify(secondPayment));
  const renewed = (await pool.query('select s.id,current_period_start,current_period_end,billing_anchor_day from app.subscriptions s join app.workspaces w on w.id=s.workspace_id join app.user_accounts u on u.id=w.owner_user_id where u.appwrite_user_id=$1', [userId])).rows[0];
  assert.equal(new Date(renewed.current_period_start).getTime(), new Date(initial.current_period_start).getTime());
  assert.equal(new Date(renewed.current_period_end).getTime(), addMonth(new Date(initial.current_period_end), Number(initial.billing_anchor_day)).getTime());
  assert.equal(Number((await pool.query('select count(*) from app.subscription_events where subscription_id=$1', [initial.id])).rows[0].count), 2);
  assert.equal((await store.getRenewalStatus(userId)).automaticRenewalEnabled, false);
  await assert.rejects(() => store.createOrder(userId, 'team', `renewal-tier-switch-${crypto.randomUUID()}`), /不能直接切换套餐/);
  const context = (await pool.query(`select s.id subscription_id,s.workspace_id,s.plan_id,s.plan_version_id,s.current_period_start,s.current_period_end,
      u.id internal_user_id from app.subscriptions s join app.workspaces w on w.id=s.workspace_id join app.user_accounts u on u.id=w.owner_user_id
      where u.appwrite_user_id=$1`, [userId])).rows[0];
  const mandateResult = await pool.query(`insert into app.renewal_mandates(workspace_id,subscription_id,provider,provider_account_id,environment,
      collection_owner,provider_mandate_id,authorized_by,terms_version,terms_hash,consented_at,plan_id,plan_version_id,max_amount_minor,
      currency,billing_interval,billing_timezone,status,authorized_at)
      values($1,$2,'renewal-test-provider','test-account','test','merchant_managed',$3,$4,'terms-v1',$5,now(),$6,$7,$8,
      'CNY','month','UTC','active',now()) returning id`,
  [context.workspace_id, context.subscription_id, `mandate-${crypto.randomUUID()}`, context.internal_user_id, 'a'.repeat(64),
    context.plan_id, context.plan_version_id, firstOrder.amountCents]);
  const mandateId = mandateResult.rows[0].id;
  const cycleValues = { workspaceId: context.workspace_id, subscriptionId: context.subscription_id,
    periodStart: context.current_period_start, periodEnd: context.current_period_end, amount: firstOrder.amountCents,
    planId: context.plan_id, planVersionId: context.plan_version_id, authorizedMaximum: firstOrder.amountCents,
    mandateId, orderId: firstOrder.id, idempotencyKey: `cycle-${crypto.randomUUID()}` };
  const insertCycle = (owner = 'merchant_managed', account = 'test-account', environment = 'test', sequence = 1,
    amount = cycleValues.amount, authorizedMaximum = cycleValues.authorizedMaximum) => pool.query(`insert into app.billing_cycles(
      workspace_id,subscription_id,sequence,period_start,period_end,due_at,amount_minor,currency,plan_id,plan_version_id,billing_interval,
      billing_timezone,authorized_max_amount_minor,mandate_id,order_id,
      collection_owner,provider,provider_account_id,environment,idempotency_key)
      values($1,$2,$3,$4,$5,$4,$6,'CNY',$7,$8,'month','UTC',$9,$10,$11,$12,'renewal-test-provider',$13,$14,$15)`,
  [cycleValues.workspaceId, cycleValues.subscriptionId, sequence, cycleValues.periodStart, cycleValues.periodEnd,
    amount, cycleValues.planId, cycleValues.planVersionId, authorizedMaximum, cycleValues.mandateId,
    cycleValues.orderId, owner, account, environment, `${cycleValues.idempotencyKey}-${sequence}`]);
  await insertCycle();
  await assert.rejects(() => insertCycle('merchant_managed', 'different-account', 'test', 2), /billing_cycles_mandate_scope_fkey/);
  await assert.rejects(() => insertCycle('provider_managed', 'test-account', 'test', 3), /billing_cycles_mandate_scope_fkey/);
  await assert.rejects(() => insertCycle('merchant_managed', 'test-account', 'test', 4, firstOrder.amountCents + 1), /billing_cycles_authorized_amount_check/);
  await assert.rejects(() => pool.query(`insert into app.renewal_mandates(workspace_id,subscription_id,provider,provider_account_id,environment,
      collection_owner,provider_mandate_id,authorized_by,terms_version,terms_hash,consented_at,plan_id,plan_version_id,max_amount_minor,
      currency,billing_interval,billing_timezone,status,authorized_at)
      values($1,$2,'renewal-test-provider','test-account','test','merchant_managed',$3,$4,'terms-v1',$5,now(),$6,$7,$8,
      'CNY','month','UTC','active',now())`,
  [context.workspace_id, context.subscription_id, `second-mandate-${crypto.randomUUID()}`, context.internal_user_id, 'b'.repeat(64),
    context.plan_id, context.plan_version_id, firstOrder.amountCents]), /renewal_mandates_one_open_per_subscription/);
  const cycleId = (await pool.query('select id from app.billing_cycles where workspace_id=$1 and idempotency_key=$2', [cycleValues.workspaceId, `${cycleValues.idempotencyKey}-1`])).rows[0].id;
  await pool.query(`insert into app.renewal_attempts(workspace_id,cycle_id,attempt_no,provider,provider_account_id,environment,status,scheduled_at,provider_payment_id)
    values($1,$2,1,'renewal-test-provider','test-account','test','queued',now(),'unique-renewal-payment')`, [context.workspace_id, cycleId]);
  await assert.rejects(() => pool.query(`insert into app.renewal_attempts(workspace_id,cycle_id,attempt_no,provider,provider_account_id,environment,status,scheduled_at)
    values($1,$2,2,'renewal-test-provider','test-account','live','queued',now())`, [context.workspace_id, cycleId]), /renewal_attempts_provider_scope_fkey/);
  await assert.rejects(() => pool.query(`insert into app.renewal_attempts(workspace_id,cycle_id,attempt_no,provider,provider_account_id,environment,status,scheduled_at,provider_payment_id)
    values($1,$2,2,'renewal-test-provider','test-account','test','queued',now(),'unique-renewal-payment')`, [context.workspace_id, cycleId]), /renewal_attempts_provider_payment_unique/);
  console.log('PASS: 日历月续费接续、保留起始日、拒绝套餐切换，并验证续费授权/执行方/商户/环境及交易号关联约束');
} finally {
  await store.close();
  await pool.end();
}
