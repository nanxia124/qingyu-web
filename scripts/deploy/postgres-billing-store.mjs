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

  async function listTeams(appwriteUserId) {
    const r = await pool.query(`select t.id,t.name,t.created_at,
      case when tm.user_id=t.owner_user_id then 'owner' else coalesce(rb.role_code,'member') end role,
      coalesce((select p.code from app.subscriptions s join app.plans p on p.id=s.plan_id join app.workspaces tw on tw.id=s.workspace_id where tw.team_id=t.id and s.status in ('trialing','active','past_due') limit 1),'free') plan
      from app.team_memberships tm join app.teams t on t.id=tm.team_id
      left join app.workspaces w on w.team_id=t.id and w.type='team'
      left join lateral (select r.code role_code from app.role_bindings b join app.roles r on r.id=b.role_id where b.workspace_id=w.id and b.user_id=(select id from app.user_accounts where appwrite_user_id=$1) limit 1) rb on true
      where tm.user_id=(select id from app.user_accounts where appwrite_user_id=$1) and tm.status='active' and t.status='active'
      order by t.created_at`, [appwriteUserId]);
    return r.rows.map(x => ({ id: x.id, name: x.name, plan: x.plan, role: x.role, createdAt: new Date(x.created_at).toISOString() }));
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
      await client.query(`insert into app.team_memberships(team_id,user_id,status,joined_at) values($1,$2,'active',now())`, [teamId, ownerId]);
      await client.query(`insert into app.role_bindings(workspace_id,user_id,role_id,created_by) select $1,$2,id,$2 from app.roles where code='owner'`, [ws.rows[0].id, ownerId]);
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
      return { id: result.rows[0].id, status: result.rows[0].status, expiresAt: new Date(result.rows[0].expires_at).toISOString() };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  return { ensureUser, getUser: async id => publicUser(await getUser(id)), plans, createOrder, payOrder, listOrders, listTransactions, listTeams, createTeam, listTeamMembers, inviteToTeam, close: () => pool.end() };
}
