import { Pool } from "pg";

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
      const ws = await client.query(`insert into app.workspaces(type,owner_user_id,name) values('personal',$1,$2)
        on conflict(owner_user_id) where type='personal' and status <> 'deleted' do update set updated_at=now() returning id`, [userId, email || "个人空间"]);
      const workspaceId = ws.rows[0].id;
      await client.query(`insert into app.quota_accounts(workspace_id,quota_code) values($1,'monthly') on conflict do nothing`, [workspaceId]);
      await client.query("commit");
      return publicUser(await getUser(appwriteUserId));
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
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
  async function listTransactions(appwriteUserId) { const me = await getUser(appwriteUserId); if (!me) return []; const r = await pool.query(`select l.id,l.amount,l.entry_type,l.idempotency_key,l.created_at from app.quota_ledger l where l.workspace_id=$1 order by l.created_at desc limit 200`, [me.workspace_id]); return r.rows.map(x => ({ id: x.id, userId: appwriteUserId, change: Number(x.amount) * (x.entry_type === "release" ? 1 : 1), type: x.entry_type, note: x.idempotency_key, createdAt: new Date(x.created_at).getTime() })); }

  return { ensureUser, getUser: async id => publicUser(await getUser(id)), plans, createOrder, payOrder, listOrders, listTransactions, close: () => pool.end() };
}
