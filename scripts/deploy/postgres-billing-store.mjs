import { Pool } from "pg";
import crypto from "node:crypto";

const DEFAULT_PLANS = [
  { code: "free", name: "免费版", priceCents: 0, durationDays: 0, monthlyQuota: 0, level: "free", description: "注册即用", features: ["每日 20 次对话", "3 个画布", "基础模型"] },
  { code: "pro", name: "Pro", priceCents: 2900, durationDays: 30, monthlyQuota: 50000, level: "pro", description: "个人创作者首选", features: ["每月 5 万积分", "全部模型", "50 个画布", "优先响应"] },
  { code: "team", name: "团队版", priceCents: 9900, durationDays: 30, monthlyQuota: 300000, level: "team", description: "多人协作", features: ["每月 30 万积分", "无限画布", "团队协作", "专属支持"] },
];

function publicUser(row) {
  return {
    id: row.appwrite_user_id,
    email: row.email || "",
    balance: Number(row.balance || 0),
    memberLevel: row.member_level || "free",
    memberExpireAt: row.member_expire_at ? new Date(row.member_expire_at).getTime() : 0,
    inviteCode: row.invite_code,
    totalSpent: Number(row.total_spent || 0),
    workspaceId: row.workspace_id || undefined,
  };
}

function apiPlan(row) {
  return {
    id: row.code,
    name: row.name,
    priceCents: Number(row.price_minor),
    durationDays: row.billing_interval === "month" ? 30 : row.billing_interval === "year" ? 365 : 0,
    monthlyQuota: Number(row.quota_amount || 0),
    level: row.code,
    description: row.description || "",
    features: row.features || [],
  };
}

function apiOrder(row) {
  return {
    id: row.id,
    userId: row.appwrite_user_id,
    type: "membership",
    planId: row.plan_code,
    amountCents: Number(row.amount_minor),
    status: row.status,
    paymentMethod: row.payment_provider || "mock",
    transactionId: row.provider_payment_id || "",
    idempotencyKey: row.idempotency_key,
    createdAt: new Date(row.created_at).getTime(),
    paidAt: row.paid_at ? new Date(row.paid_at).getTime() : 0,
  };
}

function maskApiKey(value) {
  const key = String(value || '');
  if (key.length <= 8) return key ? '••••••••' : '';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

const API_KEY_ENCRYPTION_SECRET = process.env.API_KEY_ENCRYPTION_SECRET || process.env.JWT_SECRET || 'qingyu-api-key-migration-secret-change-me';
const API_KEY_ENCRYPTION_KEY = crypto.createHash('sha256').update(API_KEY_ENCRYPTION_SECRET).digest();

function encryptApiKey(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', API_KEY_ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
}

function decryptApiKey(value) {
  if (!value) return '';
  const [version, ivText, tagText, dataText] = String(value).split(':');
  if (version !== 'v1' || !ivText || !tagText || !dataText) throw new Error('供应商密钥密文格式无效');
  const decipher = crypto.createDecipheriv('aes-256-gcm', API_KEY_ENCRYPTION_KEY, Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8');
}

export async function createPostgresBillingStore() {
  const pool = new Pool({
    host: process.env.PGHOST || "172.19.0.2",
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || "qingyu_business",
    user: process.env.PGUSER || "user",
    password: process.env.PGPASSWORD,
    max: Number(process.env.PGPOOL_MAX || 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  await pool.query("select 1");

  async function seedPlans(client) {
    for (const p of DEFAULT_PLANS) {
      const plan = await client.query(`
        insert into app.plans(code,name,description,currency,price_minor,billing_interval,status)
        values($1,$2,$3,'CNY',$4,$5,'active')
        on conflict(code) do update set name=excluded.name,description=excluded.description,
          price_minor=excluded.price_minor,billing_interval=excluded.billing_interval,updated_at=now()
        returning id`, [p.code, p.name, p.description, p.priceCents, p.durationDays ? "month" : "none"]);
      const planId = plan.rows[0].id;
      await client.query(`insert into app.plan_versions(plan_id,version,currency,price_minor,billing_interval,feature_snapshot,quota_snapshot,effective_at)
        values($1,1,'CNY',$2,$3,$4::jsonb,$5::jsonb,now()) on conflict(plan_id,version) do update set price_minor=excluded.price_minor,
        feature_snapshot=excluded.feature_snapshot,quota_snapshot=excluded.quota_snapshot`, [planId, p.priceCents, p.durationDays ? "month" : "none", JSON.stringify(p.features), JSON.stringify({ monthly: p.monthlyQuota })]);
      for (const feature of p.features) await client.query(`insert into app.plan_features(plan_id,feature_code) values($1,$2) on conflict do nothing`, [planId, feature]);
      await client.query(`insert into app.plan_quotas(plan_id,quota_code,amount,unit,reset_interval) values($1,'monthly', $2,'credits','month') on conflict do nothing`, [planId, p.monthlyQuota]);
    }
  }

  async function ensureUser(appwriteUserId, email, inviteCode = "") {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await seedPlans(client);
      const userResult = await client.query(`insert into app.user_accounts(appwrite_user_id,email)
        values($1,$2) on conflict(appwrite_user_id) do update set email=excluded.email,updated_at=now()
        returning id,appwrite_user_id,email`, [appwriteUserId, email || ""]);
      const userId = userResult.rows[0].id;
      if (inviteCode) {
        await client.query(`update app.user_accounts target set invited_by_user_id=inviter.id
          from app.user_accounts inviter
          where target.id=$1 and target.invited_by_user_id is null and inviter.id<>target.id
            and ('QY-' || upper(substr(md5(inviter.appwrite_user_id),1,8)))=upper($2)`, [userId, String(inviteCode).trim()]);
      }
      const ws = await client.query(`insert into app.workspaces(type,owner_user_id,name) values('personal',$1,$2)
        on conflict(owner_user_id) where type='personal' and status <> 'deleted' do update set updated_at=now() returning id`, [userId, email || "个人空间"]);
      const workspaceId = ws.rows[0].id;
      await client.query(`insert into app.quota_accounts(workspace_id,quota_code) values($1,'monthly') on conflict do nothing`, [workspaceId]);
      await client.query("commit");
      return publicUser(await getUser(appwriteUserId));
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }

  async function registerSession(appwriteUserId, info = {}) {
    const installationId = /^[0-9a-f-]{36}$/i.test(String(info.installationId || '')) ? String(info.installationId) : crypto.randomUUID();
    const providerSessionId = String(info.providerSessionId || `qingyu-${crypto.randomUUID()}`).slice(0, 128);
    const client = await pool.connect();
    try {
      await client.query('begin');
      const user = await client.query(`select id,max_active_sessions from app.user_accounts where appwrite_user_id=$1 and status='active' for update`, [appwriteUserId]);
      if (!user.rowCount) throw new Error('用户不存在，请重新登录');
      const device = await client.query(`insert into app.user_devices(user_id,installation_id,display_name,client_type,os_family,browser_family,last_seen_at)
        values($1,$2,$3,$4,$5,$6,now()) on conflict(user_id,installation_id) do update set display_name=excluded.display_name,client_type=excluded.client_type,os_family=excluded.os_family,browser_family=excluded.browser_family,last_seen_at=now(),archived_at=null returning id`, [user.rows[0].id, installationId, String(info.displayName || '网页设备').slice(0,120), String(info.clientType || 'web').slice(0,32), String(info.osFamily || 'unknown').slice(0,64), String(info.browserFamily || 'unknown').slice(0,64)]);
      const existing = await client.query(`select id,device_id,expires_at from app.user_sessions where user_id=$1 and device_id=$2 and admission_status='active' and expires_at > now() order by created_at desc limit 1`, [user.rows[0].id, device.rows[0].id]);
      if (existing.rowCount) {
        await client.query(`update app.user_sessions set is_online=false where user_id=$1 and admission_status='active'`, [user.rows[0].id]);
        await client.query(`update app.user_sessions set is_online=true,last_seen_at=now() where id=$1`, [existing.rows[0].id]);
        await client.query('commit');
        return { id: existing.rows[0].id, deviceId: existing.rows[0].device_id, installationId, expiresAt: new Date(existing.rows[0].expires_at).toISOString(), maxActiveSessions: Number(user.rows[0].max_active_sessions || 3) };
      }
      const active = await client.query(`select id from app.user_sessions where user_id=$1 and admission_status in ('pending','active') and expires_at > now() order by created_at desc`, [user.rows[0].id]);
      const keep = Math.max(1, Number(user.rows[0].max_active_sessions || 3) - 1);
      for (const old of active.rows.slice(keep)) {
        await client.query(`update app.user_sessions set admission_status='revoked',revoked_at=now(),revoked_reason='session_limit',provider_revocation_status='pending',revoke_retry_at=now() where id=$1`, [old.id]);
      }
      await client.query(`update app.user_sessions set is_online=false where user_id=$1 and admission_status='active'`, [user.rows[0].id]);
      const session = await client.query(`insert into app.user_sessions(user_id,device_id,identity_provider,provider_session_id,admission_status,is_online,expires_at,last_seen_at,admitted_auth_version)
        values($1,$2,'qingyu',$3,'active',true,now()+interval '30 days',now(),(select auth_version from app.user_accounts where id=$1)) returning id,device_id,created_at,expires_at`, [user.rows[0].id, device.rows[0].id, providerSessionId]);
      await client.query('commit');
      return { id: session.rows[0].id, deviceId: session.rows[0].device_id, installationId, expiresAt: new Date(session.rows[0].expires_at).toISOString(), maxActiveSessions: Number(user.rows[0].max_active_sessions || 3) };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function listSyncEvents(appwriteUserId, workspaceId, afterSequence = 0, limit = 100) {
    const after = Math.max(0, Number(afterSequence || 0));
    const take = Math.min(200, Math.max(1, Number(limit || 100)));
    const r = await pool.query(`select e.sequence_no,e.event_type,e.schema_version,e.aggregate_type,e.aggregate_id,e.payload,e.created_at
      from app.outbox_events e join app.user_accounts u on u.appwrite_user_id=$1
      where e.workspace_id=$2 and e.sequence_no>$3 and e.status in ('pending','processing','published')
        and exists(select 1 from app.workspaces w where w.id=e.workspace_id and (w.owner_user_id=u.id or exists(select 1 from app.team_memberships tm where tm.team_id=w.team_id and tm.user_id=u.id and tm.status='active')))
      order by e.sequence_no asc limit $4`, [appwriteUserId, workspaceId, after, take]);
    return r.rows.map(x => ({ sequence: Number(x.sequence_no), type: x.event_type, schemaVersion: x.schema_version, aggregateType: x.aggregate_type, aggregateId: x.aggregate_id, payload: x.payload || {}, createdAt: new Date(x.created_at).toISOString() }));
  }

  async function ackSyncCursor(appwriteUserId, deviceId, workspaceId, sequence) {
    const next = Math.max(0, Number(sequence || 0));
    const r = await pool.query(`insert into app.sync_cursors(device_id,user_id,workspace_id,last_sequence)
      select d.id,u.id,w.id,$4 from app.user_devices d join app.user_accounts u on u.id=d.user_id and u.appwrite_user_id=$1
      join app.workspaces w on w.id=$3 and (w.owner_user_id=u.id or exists(select 1 from app.team_memberships tm where tm.team_id=w.team_id and tm.user_id=u.id and tm.status='active'))
      where d.id=$2
      on conflict(device_id,workspace_id) do update set last_sequence=greatest(app.sync_cursors.last_sequence,excluded.last_sequence),version=app.sync_cursors.version+1,updated_at=now()
      returning last_sequence`, [appwriteUserId, deviceId, workspaceId, next]);
    if (!r.rowCount) throw new Error('设备或工作空间不存在，无法保存同步游标');
    return { deviceId, workspaceId, lastSequence: Number(r.rows[0].last_sequence) };
  }

  async function listSessions(appwriteUserId) {
    const r = await pool.query(`select s.id,s.created_at,s.last_seen_at,s.expires_at,s.admission_status,s.is_online,s.revoked_at,s.revoked_reason,d.id device_id,d.display_name,d.client_type,d.os_family,d.browser_family
      from app.user_sessions s join app.user_accounts u on u.id=s.user_id join app.user_devices d on d.id=s.device_id
      where u.appwrite_user_id=$1 order by s.created_at desc limit 50`, [appwriteUserId]);
    return r.rows.map(x => ({ id: x.id, deviceId: x.device_id, displayName: x.display_name, clientType: x.client_type, osFamily: x.os_family, browserFamily: x.browser_family, status: x.admission_status, online: x.is_online === true, createdAt: new Date(x.created_at).toISOString(), lastSeenAt: x.last_seen_at ? new Date(x.last_seen_at).toISOString() : null, expiresAt: new Date(x.expires_at).toISOString(), revokedAt: x.revoked_at ? new Date(x.revoked_at).toISOString() : null, revokedReason: x.revoked_reason || null }));
  }

  async function isSessionActive(appwriteUserId, sessionId) {
    if (!sessionId) return true;
    const r = await pool.query(`select 1 from app.user_sessions s join app.user_accounts u on u.id=s.user_id where u.appwrite_user_id=$1 and s.id=$2 and s.admission_status='active' and s.is_online=true and s.expires_at > now()`, [appwriteUserId, sessionId]);
    return r.rowCount === 1;
  }

  async function revokeSession(appwriteUserId, sessionId) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const user = await client.query(`select id from app.user_accounts where appwrite_user_id=$1 and status='active'`, [appwriteUserId]);
      if (!user.rowCount) throw new Error('用户不存在，请重新登录');
      const changed = await client.query(`update app.user_sessions set admission_status='revoked',is_online=false,revoked_at=now(),revoked_reason='user_request',provider_revocation_status='pending',revoke_retry_at=now() where id=$1 and user_id=$2 and admission_status in ('pending','active') returning id`, [sessionId, user.rows[0].id]);
      if (!changed.rowCount) throw new Error('会话不存在或已经失效');
      await client.query(`insert into app.session_actions(actor_user_id,target_user_id,target_session_id,action_type,reason) values($1,$1,$2,'revoke_one','user_request')`, [user.rows[0].id, sessionId]);
      await client.query('commit');
      return { success: true, sessionId };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function getUser(appwriteUserId) {
    const result = await pool.query(`select u.appwrite_user_id,u.email,w.id workspace_id,
      coalesce(q.available,0) balance,coalesce(s.status,'trialing') subscription_status,
      coalesce(p.code,'free') member_level,s.current_period_end member_expire_at,
      coalesce((select sum(o.amount_minor) from app.orders o where o.workspace_id=w.id and o.status='paid'),0) total_spent,
      ('QY-' || upper(substr(md5(u.appwrite_user_id),1,8))) invite_code
      from app.user_accounts u join app.workspaces w on w.owner_user_id=u.id and w.type='personal'
      left join app.quota_accounts q on q.workspace_id=w.id and q.quota_code='monthly'
      left join app.subscriptions s on s.workspace_id=w.id and s.status in ('trialing','active','past_due')
      left join app.plans p on p.id=s.plan_id where u.appwrite_user_id=$1`, [appwriteUserId]);
    return result.rows[0] || null;
  }

  async function plans() {
    const result = await pool.query(`select p.code,p.name,p.description,p.price_minor,p.billing_interval,
      coalesce((select amount from app.plan_quotas q where q.plan_id=p.id and q.quota_code='monthly'),0) quota_amount,
      coalesce((select jsonb_agg(feature_code order by feature_code) from app.plan_features f where f.plan_id=p.id),'[]') features
      from app.plans p where p.status='active' order by p.price_minor`);
    return result.rows.map(apiPlan);
  }

  async function createOrder(appwriteUserId, planCode, idempotencyKey, paymentMethod = "mock") {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const me = await getUser(appwriteUserId);
      if (!me) throw new Error("用户不存在，请重新登录");
      const plan = await client.query(`select p.*,v.id plan_version_id from app.plans p join app.plan_versions v on v.plan_id=p.id and v.version=p.version where p.code=$1 and p.status='active'`, [planCode]);
      if (!plan.rowCount) throw new Error("套餐不存在");
      const p = plan.rows[0];
      const existing = await client.query(`select o.*,u.appwrite_user_id,p.code plan_code,coalesce(pay.provider,'') payment_provider,pay.provider_payment_id,pay.paid_at
        from app.orders o join app.workspaces w on w.id=o.workspace_id join app.user_accounts u on u.id=w.owner_user_id join app.plans p on p.id=o.plan_id
        left join lateral (select * from app.payments x where x.order_id=o.id order by x.created_at desc limit 1) pay on true
        where o.workspace_id=$1 and o.idempotency_key=$2`, [me.workspace_id, idempotencyKey]);
      if (existing.rowCount) { await client.query("commit"); return apiOrder(existing.rows[0]); }
      const order = await client.query(`insert into app.orders(workspace_id,plan_id,plan_version_id,order_no,status,currency,amount_minor,idempotency_key,price_snapshot)
        values($1,$2,$3,'QY-'||replace(gen_random_uuid()::text,'-',''),'pending',$4,$5,$6,$7::jsonb) returning id`, [me.workspace_id, p.id, p.plan_version_id, p.currency, p.price_minor, idempotencyKey, JSON.stringify({ code: p.code, version: p.version })]);
      const row = await client.query(`select o.*,u.appwrite_user_id,p.code plan_code,'' payment_provider,null provider_payment_id,null paid_at from app.orders o join app.workspaces w on w.id=o.workspace_id join app.user_accounts u on u.id=w.owner_user_id join app.plans p on p.id=o.plan_id where o.id=$1`, [order.rows[0].id]);
      await client.query("commit");
      return apiOrder(row.rows[0]);
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }

  async function payOrder(appwriteUserId, orderId) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(`select o.*,u.appwrite_user_id,p.code plan_code,p.name plan_name,p.price_minor,p.billing_interval,
        v.quota_snapshot,w.id workspace_id from app.orders o join app.workspaces w on w.id=o.workspace_id join app.user_accounts u on u.id=w.owner_user_id
        join app.plans p on p.id=o.plan_id join app.plan_versions v on v.id=o.plan_version_id
        where o.id=$1 and u.appwrite_user_id=$2 for update`, [orderId, appwriteUserId]);
      if (!result.rowCount) throw new Error("订单不存在");
      const order = result.rows[0];
      if (order.status === "paid") { await client.query("commit"); return { alreadyPaid: true, order: apiOrder(order), user: publicUser(await getUser(appwriteUserId)) }; }
      if (order.status !== "pending") throw new Error("此订单已关闭，不能继续付款");
      const paid = await client.query(`insert into app.payments(order_id,provider,status,amount_minor,paid_at,raw_reference)
        values($1,'mock','succeeded',$2,now(),'{}') returning id,paid_at`, [order.id, order.amount_minor]);
      await client.query(`update app.orders set status='paid',updated_at=now() where id=$1`, [order.id]);
      const days = order.billing_interval === "year" ? 365 : order.billing_interval === "month" ? 30 : 0;
      if (days > 0) await client.query(`insert into app.subscriptions(workspace_id,plan_id,plan_version_id,status,current_period_start,current_period_end)
        values($1,$2,$3,'active',now(),now()+make_interval(days=>$4)) on conflict(workspace_id) do update set plan_id=excluded.plan_id,plan_version_id=excluded.plan_version_id,status='active',current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,updated_at=now()`, [order.workspace_id, order.plan_id, order.plan_version_id, days]);
      const quota = Number(order.quota_snapshot?.monthly || 0);
      if (quota > 0) {
        const account = await client.query(`insert into app.quota_accounts(workspace_id,quota_code) values($1,'monthly') on conflict(workspace_id,quota_code) do update set updated_at=now() returning id`, [order.workspace_id]);
        await client.query(`update app.quota_accounts set granted=granted+$1,version=version+1,updated_at=now() where id=$2`, [quota, account.rows[0].id]);
        await client.query(`insert into app.quota_ledger(account_id,workspace_id,entry_type,amount,idempotency_key,metadata) values($1,$2,'grant',$3,$4,$5::jsonb) on conflict do nothing`, [account.rows[0].id, order.workspace_id, quota, `grant:order:${order.id}`, JSON.stringify({ order_id: order.id })]);
      }
      const final = await client.query(`select o.*,u.appwrite_user_id,p.code plan_code,'mock' payment_provider,$1::text provider_payment_id,$2::timestamptz paid_at from app.orders o join app.workspaces w on w.id=o.workspace_id join app.user_accounts u on u.id=w.owner_user_id join app.plans p on p.id=o.plan_id where o.id=$3`, [paid.rows[0].id, paid.rows[0].paid_at, order.id]);
      await client.query("commit");
      return { alreadyPaid: false, order: apiOrder(final.rows[0]), user: publicUser(await getUser(appwriteUserId)) };
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }

  async function listOrders(appwriteUserId) { const me = await getUser(appwriteUserId); if (!me) return []; const r = await pool.query(`select o.*,u.appwrite_user_id,p.code plan_code,coalesce(pay.provider,'') payment_provider,pay.provider_payment_id,pay.paid_at from app.orders o join app.workspaces w on w.id=o.workspace_id join app.user_accounts u on u.id=w.owner_user_id join app.plans p on p.id=o.plan_id left join lateral(select * from app.payments x where x.order_id=o.id order by x.created_at desc limit 1) pay on true where u.appwrite_user_id=$1 order by o.created_at desc`, [appwriteUserId]); return r.rows.map(apiOrder); }
  async function listTransactions(appwriteUserId) {
    const me = await getUser(appwriteUserId);
    if (!me) return [];
    const r = await pool.query(`select l.id,l.amount,l.entry_type,l.idempotency_key,l.metadata,l.created_at from app.quota_ledger l where l.workspace_id=$1 order by l.created_at desc limit 200`, [me.workspace_id]);
    return r.rows.map(x => {
      const amount = Number(x.amount);
      const explicitDelta = x.metadata && x.metadata.delta !== undefined ? Number(x.metadata.delta) : null;
      const change = explicitDelta !== null && Number.isFinite(explicitDelta)
        ? explicitDelta
        : ['grant', 'refund', 'release'].includes(x.entry_type) ? amount : -amount;
      return { id: x.id, userId: appwriteUserId, change, type: x.entry_type, note: x.metadata?.note || x.idempotency_key, createdAt: new Date(x.created_at).getTime() };
    });
  }

  async function adminStats() {
    const r = await pool.query(`select
      (select count(*) from app.user_accounts where status='active') user_count,
      (select count(*) from app.subscriptions where status in ('trialing','active','past_due') and current_period_end > now()) active_member_count,
      (select count(*) from app.orders) order_count,
      (select count(*) from app.orders where status='paid') paid_order_count,
      coalesce((select sum(amount_minor) from app.orders where status='paid'),0) revenue_minor,
      coalesce((select sum(pay.amount_minor) from app.payments pay join app.orders o on o.id=pay.order_id where o.status='paid' and pay.status='succeeded' and pay.paid_at >= current_date),0) today_revenue_minor,
      coalesce((select sum(q.available) from app.quota_accounts q),0) total_balance,
      (select count(*) from app.redeem_codes where used_by is null and (expires_at is null or expires_at > now())) unused_codes`);
    const x = r.rows[0];
    return { userCount: Number(x.user_count), activeMemberCount: Number(x.active_member_count), orderCount: Number(x.order_count), paidOrderCount: Number(x.paid_order_count), revenueCents: Number(x.revenue_minor), todayRevenueCents: Number(x.today_revenue_minor), totalBalance: Number(x.total_balance), unusedCodes: Number(x.unused_codes) };
  }

  async function adminUsers() {
    const r = await pool.query(`select u.appwrite_user_id,u.email,w.id workspace_id,
      coalesce(q.available,0) balance,coalesce(p.code,'free') member_level,s.current_period_end member_expire_at,
      coalesce((select sum(o.amount_minor) from app.orders o where o.workspace_id=w.id and o.status='paid'),0) total_spent,
      ('QY-' || upper(substr(md5(u.appwrite_user_id),1,8))) invite_code
      from app.user_accounts u left join app.workspaces w on w.owner_user_id=u.id and w.type='personal' and w.status='active'
      left join app.quota_accounts q on q.workspace_id=w.id and q.quota_code='monthly'
      left join app.subscriptions s on s.workspace_id=w.id and s.status in ('trialing','active','past_due')
      left join app.plans p on p.id=s.plan_id where u.status='active' order by u.created_at desc`);
    return r.rows.map(publicUser);
  }

  async function adminAdjustBalance(appwriteUserId, delta, note = '后台调整') {
    const amount = Number(delta);
    if (!Number.isFinite(amount) || amount === 0) throw new Error('调整额度不能为空');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const owner = await client.query(`select u.id,w.id workspace_id from app.user_accounts u join app.workspaces w on w.owner_user_id=u.id and w.type='personal' and w.status='active' where u.appwrite_user_id=$1 and u.status='active' for update`, [appwriteUserId]);
      if (!owner.rowCount) throw new Error('用户不存在');
      const account = await client.query(`insert into app.quota_accounts(workspace_id,quota_code) values($1,'monthly') on conflict(workspace_id,quota_code) do update set updated_at=now() returning id,available`, [owner.rows[0].workspace_id]);
      const accountId = account.rows[0].id;
      if (amount > 0) {
        await client.query(`update app.quota_accounts set granted=granted+$1,version=version+1,updated_at=now() where id=$2`, [amount, accountId]);
      } else {
        const available = Number(account.rows[0].available);
        if (available < Math.abs(amount)) throw new Error('可用额度不足，不能扣减');
        await client.query(`update app.quota_accounts set consumed=consumed+$1,version=version+1,updated_at=now() where id=$2`, [Math.abs(amount), accountId]);
      }
      await client.query(`insert into app.quota_ledger(account_id,workspace_id,entry_type,amount,idempotency_key,metadata) values($1,$2,'adjustment',$3,$4,$5::jsonb)`, [accountId, owner.rows[0].workspace_id, Math.abs(amount), `admin-adjust:${crypto.randomUUID()}`, JSON.stringify({ delta: amount, note })]);
      await client.query('commit');
      return publicUser(await getUser(appwriteUserId));
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function adminOrders() {
    const r = await pool.query(`select o.*,u.appwrite_user_id,p.code plan_code,coalesce(pay.provider,'') payment_provider,pay.provider_payment_id,pay.paid_at
      from app.orders o join app.workspaces w on w.id=o.workspace_id join app.user_accounts u on u.id=w.owner_user_id join app.plans p on p.id=o.plan_id
      left join lateral(select * from app.payments x where x.order_id=o.id order by x.created_at desc limit 1) pay on true order by o.created_at desc limit 1000`);
    return r.rows.map(apiOrder);
  }

  async function inviteInfo(appwriteUserId) {
    const me = await getUser(appwriteUserId);
    if (!me) throw new Error('用户不存在，请重新登录');
    const r = await pool.query(`select u.email,
      coalesce((select sum(o.amount_minor) from app.orders o join app.workspaces w on w.id=o.workspace_id where w.owner_user_id=u.id and o.status='paid'),0) total_spent,
      u.created_at from app.user_accounts u where u.invited_by_user_id=(select id from app.user_accounts where appwrite_user_id=$1) order by u.created_at desc`, [appwriteUserId]);
    return { inviteCode: me.inviteCode, invitedCount: r.rowCount, invitedList: r.rows.map(x => ({ email: x.email || '', totalSpent: Number(x.total_spent), createdAt: new Date(x.created_at).getTime() })), rewardQuota: 0 };
  }

  async function redeemCode(appwriteUserId, rawCode) {
    const code = String(rawCode || '').trim().toUpperCase();
    if (!code) throw new Error('请输入兑换码');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const user = await client.query(`select u.id,w.id workspace_id from app.user_accounts u join app.workspaces w on w.owner_user_id=u.id and w.type='personal' and w.status='active' where u.appwrite_user_id=$1 and u.status='active' for update`, [appwriteUserId]);
      if (!user.rowCount) throw new Error('用户不存在，请重新登录');
      const found = await client.query(`select c.*,p.code plan_code,p.billing_interval,v.id plan_version_id,v.quota_snapshot from app.redeem_codes c left join app.plans p on p.id=c.plan_id left join app.plan_versions v on v.plan_id=p.id and v.version=p.version where c.code=$1 for update`, [code]);
      if (!found.rowCount) throw new Error('兑换码无效');
      const item = found.rows[0];
      if (item.used_by) throw new Error('兑换码已被使用');
      if (item.expires_at && new Date(item.expires_at) <= new Date()) throw new Error('兑换码已过期');
      const account = await client.query(`insert into app.quota_accounts(workspace_id,quota_code) values($1,'monthly') on conflict(workspace_id,quota_code) do update set updated_at=now() returning id`, [user.rows[0].workspace_id]);
      let granted = 0;
      if (item.kind === 'membership') {
        if (!item.plan_id || !item.plan_version_id) throw new Error('兑换码套餐配置不完整');
        await client.query(`insert into app.subscriptions(workspace_id,plan_id,plan_version_id,status,current_period_start,current_period_end)
          values($1,$2,$3,'active',now(),now()+make_interval(days=>$4)) on conflict(workspace_id) do update set plan_id=excluded.plan_id,plan_version_id=excluded.plan_version_id,status='active',current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,updated_at=now()`, [user.rows[0].workspace_id, item.plan_id, item.plan_version_id, item.billing_interval === 'year' ? 365 : 30]);
        granted = Number(item.quota_snapshot?.monthly || 0);
      } else granted = Number(item.denomination || 0);
      if (granted > 0) {
        await client.query(`update app.quota_accounts set granted=granted+$1,version=version+1,updated_at=now() where id=$2`, [granted, account.rows[0].id]);
        await client.query(`insert into app.quota_ledger(account_id,workspace_id,entry_type,amount,idempotency_key,metadata) values($1,$2,'grant',$3,$4,$5::jsonb)`, [account.rows[0].id, user.rows[0].workspace_id, granted, `redeem:${item.id}`, JSON.stringify({ redeem_code_id: item.id })]);
      }
      await client.query(`update app.redeem_codes set used_by=$1,used_at=now() where id=$2`, [user.rows[0].id, item.id]);
      await client.query('commit');
      return { success: true, user: publicUser(await getUser(appwriteUserId)) };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function adminListCodes() {
    const r = await pool.query(`select c.id,c.code,c.kind,c.denomination,c.batch,c.expires_at,c.used_at,u.appwrite_user_id used_by,c.created_at,p.code plan_id from app.redeem_codes c left join app.user_accounts u on u.id=c.used_by left join app.plans p on p.id=c.plan_id order by c.created_at desc limit 5000`);
    return r.rows.map(x => ({ id: x.id, code: x.code, kind: x.kind, denomination: Number(x.denomination), planId: x.plan_id || '', usedBy: x.used_by || '', usedAt: x.used_at ? new Date(x.used_at).getTime() : 0, batch: x.batch || '', createdAt: new Date(x.created_at).getTime(), expiredAt: x.expires_at ? new Date(x.expires_at).getTime() : 0 }));
  }

  async function adminCreateCodes(body = {}) {
    const count = Math.min(Math.max(1, Number(body.count || 1)), 1000);
    const kind = body.kind === 'membership' ? 'membership' : 'quota';
    const denomination = Number(body.denomination || 0);
    const batch = 'B' + Date.now().toString(36);
    const client = await pool.connect();
    try {
      await client.query('begin');
      let planId = null;
      if (kind === 'membership') {
        const plan = await client.query(`select id from app.plans where code=$1 and status='active'`, [body.planId || 'pro']);
        if (!plan.rowCount) throw new Error('套餐不存在');
        planId = plan.rows[0].id;
      } else if (!Number.isFinite(denomination) || denomination <= 0) throw new Error('兑换额度必须大于0');
      const codes = [];
      for (let i = 0; i < count; i++) {
        const code = 'QY-' + crypto.randomBytes(9).toString('hex').toUpperCase().match(/.{1,6}/g).join('-');
        await client.query(`insert into app.redeem_codes(code,kind,denomination,plan_id,batch,expires_at) values($1,$2,$3,$4,$5,$6)`, [code, kind, kind === 'quota' ? denomination : 0, planId, batch, body.days ? new Date(Date.now() + Number(body.days) * 86400000) : null]);
        codes.push(code);
      }
      await client.query('commit');
      return { count: codes.length, batch, codes };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  function platformApiKeyView(row) {
    const plaintext = row.api_key_ciphertext ? decryptApiKey(row.api_key_ciphertext) : String(row.api_key || '');
    return {
      id: row.id,
      name: row.name,
      provider: row.provider,
      base_url: row.base_url,
      api_key: plaintext,
      api_key_masked: maskApiKey(plaintext),
      model: row.model || '',
      max_concurrency: row.max_concurrency === null ? null : Number(row.max_concurrency),
      is_active: row.is_active === true ? 1 : 0,
      created_at: new Date(row.created_at).getTime(),
      updated_at: new Date(row.updated_at).getTime(),
    };
  }

  async function listPlatformApiKeys() {
    const r = await pool.query(`select id,name,provider,base_url,api_key,api_key_ciphertext,model,max_concurrency,is_active,created_at,updated_at from app.platform_api_keys order by updated_at desc`);
    const result = [];
    for (const row of r.rows) {
      if (!row.api_key_ciphertext && row.api_key) {
        const ciphertext = encryptApiKey(row.api_key);
        await pool.query(`update app.platform_api_keys set api_key=null,api_key_ciphertext=$2,updated_at=now() where id=$1`, [row.id, ciphertext]);
        row.api_key_ciphertext = ciphertext;
        row.api_key = null;
      }
      result.push(platformApiKeyView(row));
    }
    return result;
  }

  async function createPlatformApiKey(body = {}) {
    const name = String(body.name || '').trim();
    const baseUrl = String(body.base_url || '').trim();
    const apiKey = String(body.api_key || '').trim();
    if (!name || !baseUrl || !apiKey) throw new Error('名称、API 地址、API Key 为必填项');
    const r = await pool.query(`insert into app.platform_api_keys(name,provider,base_url,api_key,api_key_ciphertext,model,max_concurrency,is_active) values($1,$2,$3,null,$4,$5,$6,$7) returning *`, [name, String(body.provider || 'openai'), baseUrl, encryptApiKey(apiKey), String(body.model || ''), body.max_concurrency ? Number(body.max_concurrency) : null, body.is_active === undefined ? true : Boolean(Number(body.is_active))]);
    return platformApiKeyView(r.rows[0]);
  }

  async function updatePlatformApiKey(id, body = {}) {
    const current = await pool.query(`select * from app.platform_api_keys where id=$1`, [id]);
    if (!current.rowCount) throw new Error('密钥不存在');
    const old = current.rows[0];
    const oldApiKey = old.api_key_ciphertext ? decryptApiKey(old.api_key_ciphertext) : String(old.api_key || '');
    const nextApiKey = body.api_key ? String(body.api_key) : oldApiKey;
    const r = await pool.query(`update app.platform_api_keys set name=$2,provider=$3,base_url=$4,api_key=null,api_key_ciphertext=$5,model=$6,max_concurrency=$7,is_active=$8,updated_at=now() where id=$1 returning *`, [id, body.name === undefined ? old.name : String(body.name), body.provider === undefined ? old.provider : String(body.provider), body.base_url === undefined ? old.base_url : String(body.base_url), encryptApiKey(nextApiKey), body.model === undefined ? old.model : String(body.model), body.max_concurrency === undefined ? old.max_concurrency : (body.max_concurrency ? Number(body.max_concurrency) : null), body.is_active === undefined ? old.is_active : Boolean(Number(body.is_active))]);
    return platformApiKeyView(r.rows[0]);
  }

  async function deletePlatformApiKey(id) {
    const r = await pool.query(`delete from app.platform_api_keys where id=$1 returning id`, [id]);
    if (!r.rowCount) throw new Error('密钥不存在');
    return { success: true };
  }

  async function getPlatformApiKeySecret(id) {
    const r = await pool.query(`select api_key,api_key_ciphertext from app.platform_api_keys where id=$1`, [id]);
    if (!r.rowCount) throw new Error('密钥不存在');
    return { api_key: r.rows[0].api_key_ciphertext ? decryptApiKey(r.rows[0].api_key_ciphertext) : String(r.rows[0].api_key || '') };
  }

  async function saveCanvasSnapshot(appwriteUserId, snapshot = {}) {
    const projects = Array.isArray(snapshot.projects) ? snapshot.projects.slice(0, 100) : [];
    const client = await pool.connect();
    try {
      await client.query('begin');
      const owner = await client.query(`select u.id user_id,w.id workspace_id from app.user_accounts u join app.workspaces w on w.owner_user_id=u.id and w.type='personal' and w.status='active' where u.appwrite_user_id=$1 and u.status='active'`, [appwriteUserId]);
      if (!owner.rowCount) throw new Error('用户不存在，请重新登录');
      const { user_id: userId, workspace_id: workspaceId } = owner.rows[0];
      for (const raw of projects) {
        const externalKey = String(raw.id || '').trim().slice(0, 160);
        if (!externalKey) continue;
        const project = await client.query(`insert into app.canvas_projects(workspace_id,created_by,external_key,title,background_mode,show_image_info,viewport,status,updated_at)
          values($1,$2,$3,$4,$5,$6,$7::jsonb,'active',now())
          on conflict(workspace_id,external_key) do update set title=excluded.title,background_mode=excluded.background_mode,show_image_info=excluded.show_image_info,viewport=excluded.viewport,status='active',deleted_at=null,version=app.canvas_projects.version+1,updated_at=now()
          returning id`, [workspaceId, userId, externalKey, String(raw.title || '未命名画布').slice(0, 240), String(raw.backgroundMode || 'lines').slice(0, 32), Boolean(raw.showImageInfo), JSON.stringify(raw.viewport || { x: 0, y: 0, k: 1 })]);
        const projectId = project.rows[0].id;
        await client.query(`delete from app.canvas_connections where project_id=$1 and workspace_id=$2`, [projectId, workspaceId]);
        await client.query(`delete from app.canvas_chat_sessions where project_id=$1 and workspace_id=$2`, [projectId, workspaceId]);
        await client.query(`delete from app.canvas_nodes where project_id=$1 and workspace_id=$2`, [projectId, workspaceId]);
        const nodeIds = new Map();
        for (const node of Array.isArray(raw.nodes) ? raw.nodes.slice(0, 2000) : []) {
          const nodeKey = String(node.id || '').trim().slice(0, 160);
          if (!nodeKey) continue;
          const inserted = await client.query(`insert into app.canvas_nodes(project_id,workspace_id,node_key,node_type,title,position,width,height,metadata) values($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb) returning id`, [projectId, workspaceId, nodeKey, String(node.type || 'text').slice(0, 120), String(node.title || '').slice(0, 240), JSON.stringify(node.position || { x: 0, y: 0 }), Math.max(1, Number(node.width) || 1), Math.max(1, Number(node.height) || 1), JSON.stringify(node.metadata || {})]);
          nodeIds.set(nodeKey, inserted.rows[0].id);
        }
        for (const connection of Array.isArray(raw.connections) ? raw.connections.slice(0, 5000) : []) {
          const connectionKey = String(connection.id || '').trim().slice(0, 160);
          const fromId = nodeIds.get(String(connection.fromNodeId || ''));
          const toId = nodeIds.get(String(connection.toNodeId || ''));
          if (!connectionKey || !fromId || !toId || fromId === toId) continue;
          await client.query(`insert into app.canvas_connections(project_id,workspace_id,connection_key,from_node_id,to_node_id) values($1,$2,$3,$4,$5)`, [projectId, workspaceId, connectionKey, fromId, toId]);
        }
        for (const session of Array.isArray(raw.chatSessions) ? raw.chatSessions.slice(0, 100) : []) {
          const sessionKey = String(session.id || '').trim().slice(0, 160);
          if (!sessionKey) continue;
          const inserted = await client.query(`insert into app.canvas_chat_sessions(project_id,workspace_id,session_key,title,created_by) values($1,$2,$3,$4,$5) returning id`, [projectId, workspaceId, sessionKey, String(session.title || '').slice(0, 240), userId]);
          for (const message of Array.isArray(session.messages) ? session.messages.slice(0, 5000) : []) {
            const messageKey = String(message.id || '').trim().slice(0, 160);
            if (!messageKey) continue;
            const allowedRole = ['user', 'assistant', 'system', 'tool', 'error'].includes(message.role) ? message.role : 'user';
            await client.query(`insert into app.canvas_chat_messages(session_id,workspace_id,message_key,role,content,detail) values($1,$2,$3,$4,$5,$6::jsonb)`, [inserted.rows[0].id, workspaceId, messageKey, allowedRole, String(message.text || '').slice(0, 200000), JSON.stringify({ title: message.title || null, meta: message.meta || null, detail: message.detail || null, references: message.references || [] })]);
          }
        }
        await client.query(`insert into app.outbox_events(event_type,aggregate_type,aggregate_id,workspace_id,payload) values('canvas.project.saved','canvas_project',$1,$2,$3::jsonb)`, [projectId, workspaceId, JSON.stringify({ externalKey, nodeCount: nodeIds.size })]);
      }
      await client.query('commit');
      return { saved: projects.length };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function listCanvasSnapshots(appwriteUserId) {
    const owner = await pool.query(`select u.id user_id,w.id workspace_id from app.user_accounts u join app.workspaces w on w.owner_user_id=u.id and w.type='personal' and w.status='active' where u.appwrite_user_id=$1 and u.status='active'`, [appwriteUserId]);
    if (!owner.rowCount) throw new Error('用户不存在，请重新登录');
    const workspaceId = owner.rows[0].workspace_id;
    const projects = await pool.query(`select id,external_key,title,background_mode,show_image_info,viewport,created_at,updated_at from app.canvas_projects where workspace_id=$1 and status='active' order by updated_at desc limit 100`, [workspaceId]);
    const result = [];
    for (const project of projects.rows) {
      const nodes = await pool.query(`select node_key,node_type,title,position,width,height,metadata from app.canvas_nodes where project_id=$1 and workspace_id=$2 order by created_at`, [project.id, workspaceId]);
      const nodeMap = new Map(nodes.rows.map(x => [x.node_key, x]));
      const nodeDbIds = await pool.query(`select id,node_key from app.canvas_nodes where project_id=$1 and workspace_id=$2`, [project.id, workspaceId]);
      const idToKey = new Map(nodeDbIds.rows.map(x => [x.id, x.node_key]));
      const connections = await pool.query(`select connection_key,from_node_id,to_node_id from app.canvas_connections where project_id=$1 and workspace_id=$2 order by created_at`, [project.id, workspaceId]);
      const sessions = await pool.query(`select id,session_key,title,created_at,updated_at from app.canvas_chat_sessions where project_id=$1 and workspace_id=$2 order by created_at`, [project.id, workspaceId]);
      const chatSessions = [];
      for (const session of sessions.rows) {
        const messages = await pool.query(`select message_key,role,content,detail,created_at from app.canvas_chat_messages where session_id=$1 and workspace_id=$2 order by created_at`, [session.id, workspaceId]);
        chatSessions.push({ id: session.session_key, title: session.title, createdAt: new Date(session.created_at).toISOString(), updatedAt: new Date(session.updated_at).toISOString(), messages: messages.rows.map(x => ({ id: x.message_key, role: x.role, text: x.content, title: x.detail?.title || undefined, meta: x.detail?.meta || undefined, detail: x.detail?.detail || undefined, references: x.detail?.references || [] })) });
      }
      result.push({ id: project.external_key, title: project.title, createdAt: new Date(project.created_at).toISOString(), updatedAt: new Date(project.updated_at).toISOString(), nodes: nodes.rows.map(x => ({ id: x.node_key, type: x.node_type, title: x.title, position: x.position, width: Number(x.width), height: Number(x.height), metadata: x.metadata || {} })), connections: connections.rows.map(x => ({ id: x.connection_key, fromNodeId: idToKey.get(x.from_node_id), toNodeId: idToKey.get(x.to_node_id) })).filter(x => x.fromNodeId && x.toNodeId), chatSessions, activeChatId: null, backgroundMode: project.background_mode, showImageInfo: project.show_image_info, viewport: project.viewport });
    }
    return { projects: result, deletedProjects: [] };
  }

  async function listTeams(appwriteUserId) {
    const r = await pool.query(`select t.id,t.name,t.created_at,
      case when tm.user_id=t.owner_user_id then 'owner' else coalesce(rb.role_code,'member') end role,
      w.id workspace_id,
      coalesce((select p.code from app.subscriptions s join app.plans p on p.id=s.plan_id join app.workspaces tw on tw.id=s.workspace_id where tw.team_id=t.id and s.status in ('trialing','active','past_due') limit 1),'free') plan
      from app.team_memberships tm join app.teams t on t.id=tm.team_id
      left join app.workspaces w on w.team_id=t.id and w.type='team'
      left join lateral (select r.code role_code from app.role_bindings b join app.roles r on r.id=b.role_id where b.workspace_id=w.id and b.user_id=(select id from app.user_accounts where appwrite_user_id=$1) limit 1) rb on true
      where tm.user_id=(select id from app.user_accounts where appwrite_user_id=$1) and tm.status='active' and t.status='active'
      order by t.created_at`, [appwriteUserId]);
    return r.rows.map(x => ({ id: x.id, name: x.name, workspaceId: x.workspace_id, plan: x.plan, role: x.role, createdAt: new Date(x.created_at).toISOString() }));
  }

  async function createTeam(appwriteUserId, name) {
    const cleanName = String(name || '').trim();
    if (!cleanName || cleanName.length > 120) throw new Error('团队名称不能为空且不能超过120个字符');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const owner = await client.query(`select id from app.user_accounts where appwrite_user_id=$1 and status='active'`, [appwriteUserId]);
      if (!owner.rowCount) throw new Error('用户不存在，请重新登录');
      const ownerId = owner.rows[0].id;
      const slug = `${cleanName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50) || 'team'}-${crypto.randomBytes(4).toString('hex')}`;
      const team = await client.query(`insert into app.teams(name,slug,owner_user_id) values($1,$2,$3) returning id,name,created_at`, [cleanName, slug, ownerId]);
      const teamId = team.rows[0].id;
      const ws = await client.query(`insert into app.workspaces(type,team_id,name) values('team',$1,$2) returning id`, [teamId, cleanName]);
      const membership = await client.query(`insert into app.team_memberships(team_id,user_id,status,joined_at) values($1,$2,'active',now()) returning id`, [teamId, ownerId]);
      if (membership.rowCount !== 1) throw new Error('团队所有者关系创建失败');
      const ownerBinding = await client.query(`insert into app.role_bindings(workspace_id,user_id,role_id,created_by) select $1,$2,id,$2 from app.roles where code='owner' returning id`, [ws.rows[0].id, ownerId]);
      if (ownerBinding.rowCount !== 1) throw new Error('所有者权限模板不存在，团队创建已回滚');
      await client.query(`insert into app.outbox_events(event_type,aggregate_type,aggregate_id,workspace_id,payload) values('team.created','team',$1,$2,$3::jsonb)`, [teamId, ws.rows[0].id, JSON.stringify({ name: cleanName })]);
      await client.query('commit');
      return { id: teamId, name: team.rows[0].name, plan: 'free', role: 'owner', createdAt: new Date(team.rows[0].created_at).toISOString() };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function listTeamMembers(appwriteUserId, teamId) {
    const r = await pool.query(`select u.appwrite_user_id,u.email,u.display_name,tm.status,tm.joined_at,
      case when t.owner_user_id=tm.user_id then 'owner' else coalesce(rb.role_code,'member') end role
      from app.team_memberships tm join app.teams t on t.id=tm.team_id join app.user_accounts u on u.id=tm.user_id
      left join app.workspaces w on w.team_id=t.id and w.type='team'
      left join lateral (select r.code role_code from app.role_bindings b join app.roles r on r.id=b.role_id where b.workspace_id=w.id and b.user_id=tm.user_id limit 1) rb on true
      where tm.team_id=$1 and tm.status in ('active','invited') and exists (select 1 from app.team_memberships me join app.user_accounts mu on mu.id=me.user_id where me.team_id=t.id and me.user_id=(select id from app.user_accounts where appwrite_user_id=$2) and me.status='active')
      order by tm.joined_at nulls last,tm.created_at`, [teamId, appwriteUserId]);
    return r.rows.map(x => ({ id: x.appwrite_user_id, email: x.email || '', name: x.display_name || x.email || '', status: x.status, role: x.role, joinedAt: x.joined_at ? new Date(x.joined_at).toISOString() : null }));
  }

  async function inviteToTeam(appwriteUserId, teamId, email) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) throw new Error('请输入正确的邮箱');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const actor = await client.query(`select u.id from app.user_accounts u join app.team_memberships tm on tm.user_id=u.id where u.appwrite_user_id=$1 and tm.team_id=$2 and tm.status='active' and (u.id=(select owner_user_id from app.teams where id=$2) or exists(select 1 from app.role_bindings b join app.workspaces w on w.id=b.workspace_id join app.roles r on r.id=b.role_id where w.team_id=$2 and b.user_id=u.id and r.code in ('owner','admin')))`, [appwriteUserId, teamId]);
      if (!actor.rowCount) throw new Error('没有邀请成员的权限');
      const target = await client.query(`select id from app.user_accounts where lower(email)=lower($1)`, [cleanEmail]);
      const existing = await client.query(`select id from app.team_invitations where team_id=$1 and lower(email)=lower($2) and status='pending' and expires_at>now()`, [teamId, cleanEmail]);
      if (existing.rowCount) { await client.query('commit'); return { id: existing.rows[0].id, status: 'pending', alreadyExists: true }; }
      const token = crypto.randomBytes(32).toString('hex');
      const result = await client.query(`insert into app.team_invitations(team_id,email,invited_user_id,invited_by,token_hash,expires_at) values($1,$2,$3,$4,$5,now()+interval '7 days') returning id,status,expires_at`, [teamId, cleanEmail, target.rows[0]?.id || null, actor.rows[0].id, crypto.createHash('sha256').update(token).digest('hex')]);
      await client.query('commit');
      return { id: result.rows[0].id, status: result.rows[0].status, expiresAt: new Date(result.rows[0].expires_at).toISOString(), inviteToken: token };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function acceptTeamInvitation(appwriteUserId, token) {
    const cleanToken = String(token || '').trim();
    if (!cleanToken) throw new Error('邀请链接无效');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const me = await client.query(`select id,email from app.user_accounts where appwrite_user_id=$1 and status='active'`, [appwriteUserId]);
      if (!me.rowCount) throw new Error('用户不存在，请重新登录');
      const tokenHash = crypto.createHash('sha256').update(cleanToken).digest('hex');
      const invitation = await client.query(`select i.*,t.name team_name from app.team_invitations i join app.teams t on t.id=i.team_id where i.token_hash=$1 for update`, [tokenHash]);
      if (!invitation.rowCount) throw new Error('邀请不存在或已失效');
      const invite = invitation.rows[0];
      if (invite.status !== 'pending' || new Date(invite.expires_at) <= new Date()) throw new Error('邀请不存在或已失效');
      if (String(invite.email).toLowerCase() !== String(me.rows[0].email || '').toLowerCase()) throw new Error('该邀请不是发给当前登录邮箱的');
      await client.query(`insert into app.team_memberships(team_id,user_id,status,joined_at,invited_by) values($1,$2,'active',now(),$3)
        on conflict(team_id,user_id) do update set status='active',joined_at=coalesce(app.team_memberships.joined_at,now()),left_at=null,updated_at=now()`, [invite.team_id, me.rows[0].id, invite.invited_by]);
      const membership = await client.query(`select id from app.team_memberships where team_id=$1 and user_id=$2`, [invite.team_id, me.rows[0].id]);
      const workspace = await client.query(`select id from app.workspaces where team_id=$1 and type='team'`, [invite.team_id]);
      await client.query(`insert into app.role_bindings(workspace_id,user_id,role_id,created_by) select $1,$2,id,$2 from app.roles where code='member' on conflict do nothing`, [workspace.rows[0].id, me.rows[0].id]);
      await client.query(`update app.team_invitations set status='accepted',accepted_at=now(),invited_user_id=$1 where id=$2`, [me.rows[0].id, invite.id]);
      await client.query(`insert into app.membership_events(membership_id,event_type,actor_user_id,metadata) values($1,'accepted',$2,'{}'::jsonb)`, [membership.rows[0].id, me.rows[0].id]);
      await client.query('commit');
      return { teamId: invite.team_id, teamName: invite.team_name, status: 'active' };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function updateTeamMember(actorAppwriteUserId, teamId, targetAppwriteUserId, change = {}) {
    const nextRole = change.role ? String(change.role) : null;
    const nextStatus = change.status ? String(change.status) : null;
    if (nextRole && !['admin','editor','viewer','member'].includes(nextRole)) throw new Error('不支持的成员角色');
    if (nextStatus && !['active','suspended','left'].includes(nextStatus)) throw new Error('不支持的成员状态');
    const departmentId = change.departmentId === undefined ? undefined : (change.departmentId || null);
    const jobTitleId = change.jobTitleId === undefined ? undefined : (change.jobTitleId || null);
    if (!nextRole && !nextStatus && departmentId === undefined && jobTitleId === undefined) throw new Error('没有需要修改的内容');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const actor = await client.query(`select u.id,t.owner_user_id from app.user_accounts u join app.teams t on t.id=$2 join app.team_memberships tm on tm.team_id=t.id and tm.user_id=u.id where u.appwrite_user_id=$1 and tm.status='active' and (u.id=t.owner_user_id or exists(select 1 from app.role_bindings b join app.workspaces w on w.id=b.workspace_id join app.roles r on r.id=b.role_id where w.team_id=t.id and b.user_id=u.id and r.code='admin'))`, [actorAppwriteUserId, teamId]);
      if (!actor.rowCount) throw new Error('没有管理成员的权限');
      const target = await client.query(`select u.id,tm.id membership_id,tm.status current_status,t.owner_user_id from app.user_accounts u join app.team_memberships tm on tm.user_id=u.id and tm.team_id=$2 join app.teams t on t.id=$2 where u.appwrite_user_id=$1 for update`, [targetAppwriteUserId, teamId]);
      if (!target.rowCount) throw new Error('成员不存在');
      if (target.rows[0].owner_user_id === target.rows[0].id) throw new Error('团队所有者不能通过成员接口修改');
      const finalStatus = nextStatus || target.rows[0].current_status;
      await client.query(`update app.team_memberships set status=$1::app.membership_status,left_at=case when $1='left' then now() else null end,department_id=coalesce($3,department_id),job_title_id=coalesce($4,job_title_id),updated_at=now() where id=$2`, [finalStatus, target.rows[0].membership_id, departmentId, jobTitleId]);
      if (finalStatus === 'left' || finalStatus === 'suspended') {
        await client.query(`delete from app.role_bindings where user_id=$1 and workspace_id in (select id from app.workspaces where team_id=$2)`, [target.rows[0].id, teamId]);
      } else if (nextRole) {
        const workspace = await client.query(`select id from app.workspaces where team_id=$1 and type='team'`, [teamId]);
        await client.query(`delete from app.role_bindings where user_id=$1 and workspace_id=$2`, [target.rows[0].id, workspace.rows[0].id]);
        await client.query(`insert into app.role_bindings(workspace_id,user_id,role_id,created_by) select $1,$2,id,$3 from app.roles where code=$4`, [workspace.rows[0].id, target.rows[0].id, actor.rows[0].id, nextRole]);
      }
      const eventType = finalStatus === 'left' ? 'left' : finalStatus === 'suspended' ? 'suspended' : 'reinstated';
      await client.query(`insert into app.membership_events(membership_id,event_type,actor_user_id,metadata) values($1,$2,$3,$4::jsonb)`, [target.rows[0].membership_id, eventType, actor.rows[0].id, JSON.stringify({ role: nextRole })]);
      await client.query('commit');
      return { userId: targetAppwriteUserId, status: finalStatus, role: nextRole || null };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function listDepartments(appwriteUserId, teamId) {
    const r = await pool.query(`select d.id,d.name,d.parent_id,d.status,d.created_at from app.departments d where d.team_id=$1 and d.status='active' and exists(select 1 from app.team_memberships tm where tm.team_id=d.team_id and tm.user_id=(select id from app.user_accounts where appwrite_user_id=$2) and tm.status='active') order by d.parent_id nulls first,d.name`, [teamId, appwriteUserId]);
    return r.rows.map(x => ({ id: x.id, name: x.name, parentId: x.parent_id, status: x.status, createdAt: new Date(x.created_at).toISOString() }));
  }

  async function createDepartment(appwriteUserId, teamId, name, parentId = null) {
    const cleanName = String(name || '').trim();
    if (!cleanName || cleanName.length > 120) throw new Error('部门名称不能为空且不能超过120个字符');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const manager = await client.query(`select u.id from app.user_accounts u join app.team_memberships tm on tm.user_id=u.id and tm.team_id=$2 and tm.status='active' join app.teams t on t.id=$2 where u.appwrite_user_id=$1 and (u.id=t.owner_user_id or exists(select 1 from app.role_bindings b join app.workspaces w on w.id=b.workspace_id join app.roles r on r.id=b.role_id where w.team_id=$2 and b.user_id=u.id and r.code='admin'))`, [appwriteUserId, teamId]);
      if (!manager.rowCount) throw new Error('没有管理部门的权限');
      const result = await client.query(`insert into app.departments(team_id,parent_id,name) values($1,$2,$3) returning id,name,parent_id,status,created_at`, [teamId, parentId || null, cleanName]);
      await client.query('commit');
      const x = result.rows[0];
      return { id: x.id, name: x.name, parentId: x.parent_id, status: x.status, createdAt: new Date(x.created_at).toISOString() };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function listJobTitles(appwriteUserId, teamId) {
    const r = await pool.query(`select j.id,j.name,j.status,j.created_at from app.job_titles j where j.team_id=$1 and j.status='active' and exists(select 1 from app.team_memberships tm where tm.team_id=j.team_id and tm.user_id=(select id from app.user_accounts where appwrite_user_id=$2) and tm.status='active') order by j.name`, [teamId, appwriteUserId]);
    return r.rows.map(x => ({ id: x.id, name: x.name, status: x.status, createdAt: new Date(x.created_at).toISOString() }));
  }

  async function createJobTitle(appwriteUserId, teamId, name) {
    const cleanName = String(name || '').trim();
    if (!cleanName || cleanName.length > 120) throw new Error('岗位名称不能为空且不能超过120个字符');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const manager = await client.query(`select u.id from app.user_accounts u join app.team_memberships tm on tm.user_id=u.id and tm.team_id=$2 and tm.status='active' join app.teams t on t.id=$2 where u.appwrite_user_id=$1 and (u.id=t.owner_user_id or exists(select 1 from app.role_bindings b join app.workspaces w on w.id=b.workspace_id join app.roles r on r.id=b.role_id where w.team_id=$2 and b.user_id=u.id and r.code='admin'))`, [appwriteUserId, teamId]);
      if (!manager.rowCount) throw new Error('没有管理岗位的权限');
      const result = await client.query(`insert into app.job_titles(team_id,name) values($1,$2) returning id,name,status,created_at`, [teamId, cleanName]);
      await client.query('commit');
      const x = result.rows[0];
      return { id: x.id, name: x.name, status: x.status, createdAt: new Date(x.created_at).toISOString() };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function listAssets(appwriteUserId, type = 'all', keyword = '') {
    const r = await pool.query(`select a.id,a.title,a.asset_type,a.visibility,a.status,a.created_at,a.updated_at,
      coalesce((select sum(1) from app.asset_likes l where l.asset_id=a.id),0) like_count,
      coalesce((select v.metadata from app.asset_versions v where v.asset_id=a.id order by v.version_no desc limit 1),'{}'::jsonb) metadata,
      exists(select 1 from app.collections c join app.collection_items ci on ci.collection_id=c.id where c.workspace_id=a.workspace_id and c.created_by=(select id from app.user_accounts where appwrite_user_id=$1) and c.name='favorites' and ci.asset_id=a.id) is_favorite
      from app.assets a where a.status='active' and ($2='all' or a.asset_type=$2) and ($3='' or a.title ilike '%'||$3||'%') and exists(select 1 from app.workspaces w where w.id=a.workspace_id and (w.owner_user_id=(select id from app.user_accounts where appwrite_user_id=$1) or exists(select 1 from app.team_memberships tm where tm.team_id=w.team_id and tm.user_id=(select id from app.user_accounts where appwrite_user_id=$1) and tm.status='active'))) order by a.updated_at desc limit 200`, [appwriteUserId, type, keyword]);
    return r.rows.map(x => ({ id: x.id, name: x.title, type: x.asset_type, visibility: x.visibility, likeCount: Number(x.like_count), favorited: x.is_favorite, metadata: x.metadata || {}, createdAt: new Date(x.created_at).toISOString(), updatedAt: new Date(x.updated_at).toISOString() }));
  }

  async function listFavorites(appwriteUserId) { return listAssets(appwriteUserId, 'all', '').then(items => items.filter(x => x.favorited)); }

  async function toggleFavorite(appwriteUserId, assetId, favorite) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const user = await client.query(`select id from app.user_accounts where appwrite_user_id=$1 and status='active'`, [appwriteUserId]);
      if (!user.rowCount) throw new Error('用户不存在，请重新登录');
      const access = await client.query(`select a.id,a.workspace_id from app.assets a where a.id=$1 and a.status='active' and exists(select 1 from app.workspaces w where w.id=a.workspace_id and (w.owner_user_id=$2 or exists(select 1 from app.team_memberships tm where tm.team_id=w.team_id and tm.user_id=$2 and tm.status='active')))`, [assetId, user.rows[0].id]);
      if (!access.rowCount) throw new Error('资产不存在或无权访问');
      let collection = await client.query(`select id from app.collections where workspace_id=$1 and created_by=$2 and name='favorites' limit 1`, [access.rows[0].workspace_id, user.rows[0].id]);
      if (!collection.rowCount) collection = await client.query(`insert into app.collections(workspace_id,created_by,name,description) values($1,$2,'favorites','个人收藏') returning id`, [access.rows[0].workspace_id, user.rows[0].id]);
      if (favorite) await client.query(`insert into app.collection_items(collection_id,asset_id,added_by,workspace_id) values($1,$2,$3,$4) on conflict do nothing`, [collection.rows[0].id, assetId, user.rows[0].id, access.rows[0].workspace_id]);
      else await client.query(`delete from app.collection_items where collection_id=$1 and asset_id=$2`, [collection.rows[0].id, assetId]);
      await client.query('commit');
      return { assetId, favorited: Boolean(favorite) };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function createAssetFromFile(appwriteUserId, file) {
    const title = String(file.title || '').trim();
    const assetType = String(file.assetType || 'file').trim().toLowerCase();
    if (!title || title.length > 240) throw new Error('文件名称不能为空且不能超过240个字符');
    if (!['image','video','audio','doc','file'].includes(assetType)) throw new Error('不支持的资产类型');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const owner = await client.query(`select u.id,w.id workspace_id from app.user_accounts u join app.workspaces w on w.owner_user_id=u.id and w.type='personal' and w.status='active' where u.appwrite_user_id=$1 and u.status='active'`, [appwriteUserId]);
      if (!owner.rowCount) throw new Error('用户不存在，请重新登录');
      const workspaceId = owner.rows[0].workspace_id;
      const object = await client.query(`insert into app.file_objects(workspace_id,uploaded_by,storage_provider,bucket,object_key,checksum,size_bytes,mime_type,status) values($1,$2,$3,$4,$5,$6,$7,$8,'ready') returning id`, [workspaceId, owner.rows[0].id, file.storageProvider || 'local', file.bucket || 'qingyu-assets', file.objectKey, file.checksum, file.sizeBytes, file.mimeType || 'application/octet-stream']);
      const metadata = file.metadata && typeof file.metadata === 'object' ? file.metadata : {};
      let generationTaskId = null;
      if (metadata.source === 'image_generation') {
        const task = await client.query(`insert into app.generation_tasks(workspace_id,created_by,task_type,provider,model,prompt,parameters,status,request_id,idempotency_key,started_at,finished_at)
          values($1,$2,'image',$3,$4,$5,$6::jsonb,'succeeded',$7,$8,now(),now()) returning id`, [workspaceId, owner.rows[0].id, String(metadata.provider || 'configured').slice(0,80), String(metadata.model || '').slice(0,160), String(metadata.prompt || '').slice(0,2000), JSON.stringify({ quality: metadata.quality || null, size: metadata.size || null }), `asset-${crypto.randomUUID()}`, `asset-upload-${crypto.randomUUID()}`]);
        generationTaskId = task.rows[0].id;
      }
      const asset = await client.query(`insert into app.assets(workspace_id,created_by,source_generation_id,asset_type,title,visibility,moderation_status,status) values($1,$2,$3,$4,$5,'private','approved','active') returning id,title,asset_type,visibility,status,created_at,updated_at`, [workspaceId, owner.rows[0].id, generationTaskId, assetType, title]);
      const versionMetadata = { ...metadata, mimeType: file.mimeType || 'application/octet-stream', sizeBytes: file.sizeBytes, checksum: file.checksum };
      const version = await client.query(`insert into app.asset_versions(asset_id,workspace_id,version_no,created_by,metadata) values($1,$2,1,$3,$4::jsonb) returning id`, [asset.rows[0].id, workspaceId, owner.rows[0].id, JSON.stringify(versionMetadata)]);
      await client.query(`insert into app.asset_files(asset_version_id,file_id,role,workspace_id) values($1,$2,'source',$3)`, [version.rows[0].id, object.rows[0].id, workspaceId]);
      if (generationTaskId) await client.query(`insert into app.generation_outputs(task_id,workspace_id,file_id,output_type,content_status,metadata) values($1,$2,$3,'image','approved',$4::jsonb)`, [generationTaskId, workspaceId, object.rows[0].id, JSON.stringify({ assetId: asset.rows[0].id, width: metadata.width || null, height: metadata.height || null })]);
      await client.query(`insert into app.outbox_events(event_type,aggregate_type,aggregate_id,workspace_id,payload) values('asset.created','asset',$1,$2,$3::jsonb)`, [asset.rows[0].id, workspaceId, JSON.stringify({ title, assetType })]);
      await client.query('commit');
      return { id: asset.rows[0].id, name: asset.rows[0].title, type: asset.rows[0].asset_type, visibility: asset.rows[0].visibility, favorited: false, createdAt: new Date(asset.rows[0].created_at).toISOString(), updatedAt: new Date(asset.rows[0].updated_at).toISOString(), objectKey: file.objectKey };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function getAssetFile(appwriteUserId, assetId) {
    const r = await pool.query(`select a.title,f.storage_provider,f.bucket,f.object_key,f.mime_type,f.size_bytes,f.checksum
      from app.assets a join app.asset_versions v on v.asset_id=a.id and v.workspace_id=a.workspace_id and v.version_no=1
      join app.asset_files af on af.asset_version_id=v.id and af.workspace_id=a.workspace_id and af.role='source'
      join app.file_objects f on f.id=af.file_id and f.workspace_id=a.workspace_id
      where a.id=$1 and a.status='active' and f.status='ready' and exists(select 1 from app.workspaces w where w.id=a.workspace_id and (w.owner_user_id=(select id from app.user_accounts where appwrite_user_id=$2) or exists(select 1 from app.team_memberships tm where tm.team_id=w.team_id and tm.user_id=(select id from app.user_accounts where appwrite_user_id=$2) and tm.status='active'))) limit 1`, [assetId, appwriteUserId]);
    if (!r.rowCount) throw new Error('资产不存在或无权访问');
    const x = r.rows[0];
    return { title: x.title, storageProvider: x.storage_provider, bucket: x.bucket, objectKey: x.object_key, mimeType: x.mime_type || 'application/octet-stream', sizeBytes: Number(x.size_bytes || 0), checksum: x.checksum || '' };
  }

  return { ensureUser, registerSession, listSessions, isSessionActive, revokeSession, listSyncEvents, ackSyncCursor, getUser: async id => publicUser(await getUser(id)), plans, createOrder, payOrder, listOrders, listTransactions, adminStats, adminUsers, adminAdjustBalance, adminOrders, inviteInfo, redeemCode, adminListCodes, adminCreateCodes, listPlatformApiKeys, createPlatformApiKey, updatePlatformApiKey, deletePlatformApiKey, getPlatformApiKeySecret, saveCanvasSnapshot, listCanvasSnapshots, listTeams, createTeam, listTeamMembers, inviteToTeam, acceptTeamInvitation, updateTeamMember, listDepartments, createDepartment, listJobTitles, createJobTitle, listAssets, listFavorites, toggleFavorite, createAssetFromFile, getAssetFile, close: () => pool.end() };
}
