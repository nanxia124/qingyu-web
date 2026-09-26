import { Pool } from "pg";
import crypto from "node:crypto";
import { isAdminPasswordHash } from './admin-password.mjs';
import { isAssetPreviewVariant } from './asset-upload.mjs';

// 模块载入时就检查，数据库测试中后续直接创建 Pool 也不能使用远程 PGHOST。
const postgresHost = process.env.PGHOST || (process.env.NODE_ENV === 'production' ? '172.19.0.2' : '127.0.0.1');
if (process.env.NODE_ENV !== 'production'
  && !['localhost', '127.0.0.1', '::1', 'db', 'qingyu-local-db', 'host.docker.internal'].includes(postgresHost)) {
  throw new Error('PGHOST 只允许本机或本地数据库容器，本地开发和测试禁止连接远程数据库');
}

const DEFAULT_PLANS = [
  { code: "free", name: "免费版", priceCents: 0, durationDays: 0, monthlyQuota: 0, level: "free", description: "注册一次赠送50积分，用完需订阅", features: ["一次性赠送50积分", "积分用完后需订阅"] },
  { code: "pro", name: "Pro", priceCents: 2900, durationDays: 30, monthlyQuota: 50000, level: "pro", description: "个人创作者首选", features: ["每月 5 万积分", "全部模型", "50 个画布", "优先响应"] },
  { code: "team", name: "团队版", priceCents: 9900, durationDays: 30, monthlyQuota: 300000, level: "team", description: "多人协作", features: ["每月 30 万积分", "无限画布", "团队协作", "专属支持"] },
];

function sessionDeviceInfo(row) {
  const legacyName = /^Mozilla\//i.test(row.display_name || '');
  const legacyBrowser = /^Mozilla\//i.test(row.browser_family || '');
  const source = `${row.display_name || ''} ${row.os_family || ''} ${row.browser_family || ''}`;
  const osFamily = /iPhone|iPad|iPod/i.test(source) ? 'iOS'
    : /Android/i.test(source) ? 'Android'
    : /Windows|Win32|Win64/i.test(source) ? 'Windows'
    : /Mac/i.test(source) ? 'macOS'
    : /Linux/i.test(source) ? 'Linux'
    : row.os_family && row.os_family !== 'unknown' ? row.os_family : '未知系统';
  // 旧信息可能已被截断；无法识别时不猜测 Chrome、Edge 或 Safari。
  const browserFamily = !legacyBrowser && row.browser_family && row.browser_family !== 'unknown' ? row.browser_family
    : /Firefox\/|FxiOS\//i.test(source) ? 'Firefox' : '浏览器';
  return {
    displayName: legacyName || !row.display_name || row.display_name === '网页设备' ? `${osFamily} · ${browserFamily}` : row.display_name,
    osFamily, browserFamily,
  };
}

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
    billingInterval: row.billing_interval,
    monthlyQuota: Number(row.quota_amount || 0),
    level: row.code,
    description: row.description || "",
    features: row.features || [],
  };
}

function addCalendarPeriod(start, interval, anchorMonth, anchorDay) {
  const source = new Date(start);
  const month = Number(anchorMonth || source.getUTCMonth() + 1) - 1;
  const day = Number(anchorDay || source.getUTCDate());
  const year = source.getUTCFullYear() + (interval === "year" ? 1 : 0);
  const targetMonth = interval === "year" ? month : source.getUTCMonth() + 1;
  const normalizedYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(normalizedYear, normalizedMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(normalizedYear, normalizedMonth, Math.min(day, lastDay), source.getUTCHours(), source.getUTCMinutes(), source.getUTCSeconds(), source.getUTCMilliseconds()));
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

const LEGACY_API_KEY_ENCRYPTION_SECRET = 'qingyu-api-key-migration-secret-change-me';
const API_KEY_ENCRYPTION_SECRET = String(process.env.API_KEY_ENCRYPTION_SECRET || '').trim();
const ACTIVE_API_KEY_ENCRYPTION_SECRET = API_KEY_ENCRYPTION_SECRET || LEGACY_API_KEY_ENCRYPTION_SECRET;
const ACTIVE_API_KEY_ENCRYPTION_KEY = crypto.createHash('sha256').update(ACTIVE_API_KEY_ENCRYPTION_SECRET).digest();
const API_KEY_ENCRYPTION_KEYS = [
  ACTIVE_API_KEY_ENCRYPTION_KEY,
  ...[
    process.env.API_KEY_ENCRYPTION_PREVIOUS_SECRET,
    process.env.JWT_SECRET,
    LEGACY_API_KEY_ENCRYPTION_SECRET,
  ]
    .map(secret => String(secret || '').trim())
    .filter(Boolean)
    .map(secret => crypto.createHash('sha256').update(secret).digest()),
].filter((key, index, keys) => keys.findIndex(candidate => candidate.equals(key)) === index);

function encryptApiKey(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ACTIVE_API_KEY_ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
}

function decryptApiKey(value) {
  if (!value) return '';
  const [version, ivText, tagText, dataText] = String(value).split(':');
  if (version !== 'v1' || !ivText || !tagText || !dataText) throw new Error('供应商密钥密文格式无效');
  const iv = Buffer.from(ivText, 'base64url');
  const tag = Buffer.from(tagText, 'base64url');
  const ciphertext = Buffer.from(dataText, 'base64url');
  for (const key of API_KEY_ENCRYPTION_KEYS) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return {
        apiKey: Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'),
        needsReEncryption: !key.equals(ACTIVE_API_KEY_ENCRYPTION_KEY),
      };
    } catch {
      // 继续尝试显式配置的旧密钥和历史默认密钥。
    }
  }
  throw new Error('供应商密钥解密失败，请检查 API_KEY_ENCRYPTION_SECRET 和旧密钥配置');
}

function collectCanvasAssetIds(value, ids = new Set()) {
  if (typeof value === 'string') {
    const match = value.match(/^(?:image|video|audio|text):([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
    if (match) ids.add(match[1].toLowerCase());
    return ids;
  }
  if (!value || typeof value !== 'object') return ids;
  if (Array.isArray(value)) {
    for (const item of value) collectCanvasAssetIds(item, ids);
    return ids;
  }
  for (const child of Object.values(value)) collectCanvasAssetIds(child, ids);
  return ids;
}

function collectCanvasAssetUses(value, path = 'metadata', uses = []) {
  if (typeof value === 'string') {
    const match = value.match(/^(?:image|video|audio|text):([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
    if (match) {
      const slotKey = path.length <= 160 ? path : `${path.slice(0, 128)}:${crypto.createHash('sha256').update(path).digest('hex').slice(0, 31)}`;
      uses.push({ assetId: match[1].toLowerCase(), slotKey });
    }
    return uses;
  }
  if (!value || typeof value !== 'object') return uses;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectCanvasAssetUses(item, `${path}[${index}]`, uses));
    return uses;
  }
  for (const [key, child] of Object.entries(value)) collectCanvasAssetUses(child, `${path}.${key}`, uses);
  return uses;
}

export async function createPostgresBillingStore({ pool: injectedPool } = {}) {
  if (process.env.NODE_ENV === 'production' && !API_KEY_ENCRYPTION_SECRET) {
    throw new Error('[security] 生产环境必须配置独立的 API_KEY_ENCRYPTION_SECRET');
  }
  const pool = injectedPool || new Pool({
    host: postgresHost,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || "qingyu_business",
    user: process.env.PGUSER || "user",
    password: process.env.PGPASSWORD,
    max: Number(process.env.PGPOOL_MAX || 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  // 生产环境默认不允许“模拟支付”。只有明确把 PAYMENT_MODE 设为 mock
  // 的隔离测试环境，才可以直接把订单标记为已支付。
  const paymentMode = String(process.env.PAYMENT_MODE || '').trim().toLowerCase();
  await pool.query("select 1");

  async function setWorkspaceUserContext(client, appwriteUserId) {
    const user = await client.query(`select id from app.user_accounts where appwrite_user_id=$1 and status='active'`, [appwriteUserId]);
    if (!user.rowCount) throw new Error('用户不存在，请重新登录');
    await client.query(`select set_config('app.user_id',$1,true)`, [user.rows[0].id]);
    return user.rows[0].id;
  }

  async function ensureAdminAccount(username, passwordHash) {
    const cleanUsername = String(username || '').trim().slice(0, 64);
    const cleanHash = String(passwordHash || '').trim();
    if (!cleanUsername || !isAdminPasswordHash(cleanHash)) throw new Error('管理员账号初始化参数无效');
    await pool.query(`insert into app.admin_accounts(username,password_hash)
      values($1,$2) on conflict(username) do nothing`, [cleanUsername, cleanHash]);
    return getAdminAccount(cleanUsername);
  }

  async function getAdminAccount(username) {
    const result = await pool.query(`select username,password_hash,status,last_login_at from app.admin_accounts where username=$1`, [String(username || '').trim().slice(0, 64)]);
    return result.rows[0] || null;
  }

  async function touchAdminLogin(username) {
    const result = await pool.query(`update app.admin_accounts set last_login_at=now(),updated_at=now() where username=$1 and status='active' returning username,password_hash,status,last_login_at`, [String(username || '').trim().slice(0, 64)]);
    return result.rows[0] || null;
  }

  async function changeAdminPassword(username, oldPasswordHash, newPasswordHash) {
    if (!isAdminPasswordHash(oldPasswordHash) || !isAdminPasswordHash(newPasswordHash)) throw new Error('管理员密码记录格式无效');
    const result = await pool.query(`update app.admin_accounts set password_hash=$3,updated_at=now() where username=$1 and password_hash=$2 and status='active' returning username`, [String(username || '').trim().slice(0, 64), String(oldPasswordHash || ''), String(newPasswordHash || '')]);
    return result.rowCount === 1;
  }

  async function upgradeAdminPasswordHash(username, expectedPasswordHash, newPasswordHash) {
    if (!isAdminPasswordHash(expectedPasswordHash) || !isAdminPasswordHash(newPasswordHash)) throw new Error('管理员密码记录格式无效');
    const result = await pool.query(`update app.admin_accounts set password_hash=$3,updated_at=now()
      where username=$1 and password_hash=$2 and status='active' returning username`,
    [String(username || '').trim().slice(0, 64), String(expectedPasswordHash), String(newPasswordHash)]);
    return result.rowCount === 1;
  }

  function adminLoginAttemptKey(username) {
    return crypto.createHash('sha256').update(String(username || '').trim().toLowerCase()).digest('hex');
  }

  async function reserveAdminLoginAttempt(username) {
    const accountKey = adminLoginAttemptKey(username);
    const client = await pool.connect();
    try {
      await client.query('begin');
      // 登录很少发生，短事务串行化限速写入；保留原有 4096 条记录上限，防止随机账号撑大表。
      await client.query('select pg_advisory_xact_lock(70420260924)');
      await client.query(`delete from app.admin_login_attempt_limits
        where account_key in (
          select account_key from app.admin_login_attempt_limits
          where window_started_at < now() - interval '24 hours'
          order by window_started_at limit 100 for update skip locked
        )`);
      const existing = await client.query(`select account_key from app.admin_login_attempt_limits where account_key=$1`, [accountKey]);
      if (!existing.rowCount) {
        const active = await client.query(`select count(*)::integer as count from app.admin_login_attempt_limits
          where window_started_at >= now() - interval '24 hours'`);
        if (Number(active.rows[0]?.count || 0) >= 4096) {
          await client.query('commit');
          return { retryAfter: 60 };
        }
      }
      const result = await client.query(`insert into app.admin_login_attempt_limits(account_key,attempt_count,window_started_at)
        values($1,1,now())
        on conflict(account_key) do update set
          attempt_count=case
            when app.admin_login_attempt_limits.window_started_at <= now() - interval '15 minutes' then 1
            else least(app.admin_login_attempt_limits.attempt_count + 1,11)
          end,
          window_started_at=case
            when app.admin_login_attempt_limits.window_started_at <= now() - interval '15 minutes' then now()
            else app.admin_login_attempt_limits.window_started_at
          end
        returning attempt_count,
          greatest(1,ceil(extract(epoch from (window_started_at + interval '15 minutes' - now())))::integer) as retry_after`, [accountKey]);
      const row = result.rows[0];
      if (!row) throw new Error('管理员登录限速记录未能保存');
      await client.query('commit');
      return Number(row.attempt_count) > 10
        ? { retryAfter: Number(row.retry_after) }
        : { retryAfter: 0 };
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function clearAdminLoginAttempts(username) {
    const result = await pool.query(`delete from app.admin_login_attempt_limits where account_key=$1`, [adminLoginAttemptKey(username)]);
    return result.rowCount === 1;
  }

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

  async function ensureUser(appwriteUserId, email, inviteCode = "", appwriteCreatedAt = null) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await seedPlans(client);
      const userResult = await client.query(`insert into app.user_accounts(appwrite_user_id,email)
        values($1,$2) on conflict(appwrite_user_id) do update set email=excluded.email,updated_at=now()
        returning id,appwrite_user_id,email,(xmax=0) is_new`, [appwriteUserId, email || ""]);
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
      const createdTime = Date.parse(appwriteCreatedAt || "");
      if (userResult.rows[0].is_new && Number.isFinite(createdTime)) {
        const policy = await client.query(`select amount,effective_at from app.credit_system_policies where policy_key='signup_gift'`);
        if (policy.rowCount && createdTime >= new Date(policy.rows[0].effective_at).getTime()) {
          const account = await client.query(`select id from app.quota_accounts where workspace_id=$1 and quota_code='monthly' for update`, [workspaceId]);
          const amount = Number(policy.rows[0].amount);
          const grant = await client.query(`insert into app.quota_ledger(account_id,workspace_id,entry_type,amount,idempotency_key,metadata)
            values($1,$2,'grant',$3,$4,$5::jsonb) on conflict(idempotency_key) do nothing returning id`, [account.rows[0].id, workspaceId, amount, `grant:signup:${userId}`, JSON.stringify({ source: 'signup', appwrite_created_at: appwriteCreatedAt })]);
          if (grant.rowCount) await client.query(`update app.quota_accounts set granted=granted+$2,version=version+1,updated_at=now() where id=$1`, [account.rows[0].id, amount]);
        }
      }
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
      where d.id::text=$2 or d.installation_id=$2
      on conflict(device_id,workspace_id) do update set last_sequence=greatest(app.sync_cursors.last_sequence,excluded.last_sequence),version=app.sync_cursors.version+1,updated_at=now()
      returning last_sequence`, [appwriteUserId, deviceId, workspaceId, next]);
    if (!r.rowCount) throw new Error('设备或工作空间不存在，无法保存同步游标');
    return { deviceId, workspaceId, lastSequence: Number(r.rows[0].last_sequence) };
  }

  async function listSessions(appwriteUserId) {
    const r = await pool.query(`select s.id,s.created_at,s.last_seen_at,s.expires_at,s.admission_status,s.is_online,s.revoked_at,s.revoked_reason,d.id device_id,d.installation_id,d.display_name,d.client_type,d.os_family,d.browser_family
      from app.user_sessions s join app.user_accounts u on u.id=s.user_id join app.user_devices d on d.id=s.device_id
      where u.appwrite_user_id=$1
      order by (s.admission_status in ('pending','active') and s.expires_at > now()) desc, s.created_at desc limit 50`, [appwriteUserId]);
    const now = Date.now();
    return r.rows.map(x => {
      const status = ['pending', 'active'].includes(x.admission_status) && new Date(x.expires_at).getTime() <= now ? 'expired' : x.admission_status;
      return { id: x.id, deviceId: x.device_id, installationId: x.installation_id, ...sessionDeviceInfo(x), clientType: x.client_type, status, online: x.is_online === true && status === 'active', createdAt: new Date(x.created_at).toISOString(), lastSeenAt: x.last_seen_at ? new Date(x.last_seen_at).toISOString() : null, expiresAt: new Date(x.expires_at).toISOString(), revokedAt: x.revoked_at ? new Date(x.revoked_at).toISOString() : null, revokedReason: x.revoked_reason || null };
    });
  }

  async function isSessionActive(appwriteUserId, sessionId) {
    if (!sessionId) return false;
    const r = await pool.query(`select 1 from app.user_sessions s join app.user_accounts u on u.id=s.user_id where u.appwrite_user_id=$1 and s.id=$2 and s.admission_status='active' and s.is_online=true and s.expires_at > now()`, [appwriteUserId, sessionId]);
    return r.rowCount === 1;
  }

  // 离线但仍有效的设备可管理设备列表；已撤销或过期的旧票不能踢掉其他设备。
  async function isSessionAdmitted(appwriteUserId, sessionId) {
    if (!sessionId) return false;
    const r = await pool.query(`select 1 from app.user_sessions s join app.user_accounts u on u.id=s.user_id where u.appwrite_user_id=$1 and s.id=$2 and s.admission_status='active' and s.expires_at > now()`, [appwriteUserId, sessionId]);
    return r.rowCount === 1;
  }

  async function revokeSession(appwriteUserId, sessionId) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const user = await client.query(`select id from app.user_accounts where appwrite_user_id=$1 and status='active'`, [appwriteUserId]);
      if (!user.rowCount) throw new Error('用户不存在，请重新登录');
      const changed = await client.query(`update app.user_sessions set admission_status='revoked',is_online=false,revoked_at=now(),revoked_reason='user_request',provider_revocation_status='pending',revoke_retry_at=now() where id=$1 and user_id=$2 and admission_status in ('pending','active') and expires_at > now() returning id`, [sessionId, user.rows[0].id]);
      if (!changed.rowCount) throw new Error('会话不存在或已经失效');
      await client.query(`insert into app.session_actions(actor_user_id,target_user_id,target_session_id,action_type,reason) values($1,$1,$2,'revoke_one','user_request')`, [user.rows[0].id, sessionId]);
      await client.query('commit');
      return { success: true, sessionId };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function getUser(appwriteUserId) {
    const result = await pool.query(`select u.id internal_user_id,u.appwrite_user_id,u.email,w.id workspace_id,
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


  async function createFeedback(input = {}) {
    const content = String(input.content || '').trim();
    const feedbackType = String(input.feedbackType || 'other').trim();
    const contact = String(input.contact || '').trim() || null;
    if (!['suggestion', 'bug', 'other'].includes(feedbackType)) throw new Error('反馈类型无效');
    if (!content || content.length > 10000) throw new Error('反馈内容长度无效');
    if (contact && contact.length > 320) throw new Error('联系方式过长');
    const r = await pool.query(`
      with request_context as (select $1::text as appwrite_user_id)
      insert into app.feedback_submissions(user_id,workspace_id,feedback_type,content,contact,request_id)
      select u.id,w.id,$2,$3,$4,$5
      from request_context c
      left join app.user_accounts u on u.appwrite_user_id=c.appwrite_user_id and u.status='active'
      left join app.workspaces w on w.owner_user_id=u.id and w.type='personal' and w.status<>'deleted'
      returning id,created_at`,
      [input.appwriteUserId ? String(input.appwriteUserId) : null, feedbackType, content, contact, input.requestId ? String(input.requestId).slice(0, 160) : null]);
    if (!r.rowCount) throw new Error('反馈保存失败');
    return { id: r.rows[0].id, status: 'pending', createdAt: new Date(r.rows[0].created_at).toISOString() };
  }

  // 记录每次服务器代理调用的最小业务事实。精确 Token/金额仍以供应商回执为准，不能在这里臆算。
  async function recordProviderUsage(appwriteUserId, input = {}) {
    const client = await pool.connect();
    let committed = false;
    try {
      await client.query('begin');
      const me = await getUser(appwriteUserId);
      if (!me) throw new Error('用户不存在，请重新登录');
      await client.query(`select set_config('app.user_id',$1,true)`, [me.internal_user_id]);
      const requestId = String(input.requestId || crypto.randomUUID()).slice(0, 160);
      const idempotencyKey = String(input.idempotencyKey || `proxy:${requestId}`).slice(0, 160);
      const result = ['reserved', 'committed', 'released', 'failed', 'unknown'].includes(input.result) ? input.result : 'reserved';
      const quantity = Number.isFinite(Number(input.quantity)) && Number(input.quantity) >= 0 ? Number(input.quantity) : 1;
      const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};
      const existing = await client.query(`select id,quota_reservation_id,result,metadata from app.usage_records where idempotency_key=$1`, [idempotencyKey]);
      if (existing.rowCount) {
        if (!input.requestHash || existing.rows[0].metadata?.requestHash !== input.requestHash) throw new Error('同一代理请求编号不能更换模型或生成内容');
        await client.query('commit'); committed = true; return existing.rows[0];
      }

      let reservationId = null;
      const catalogModelId = Number(input.catalogModelId || 0);
      if (!Number.isSafeInteger(catalogModelId) || catalogModelId <= 0) throw new Error('该模型不属于平台积分计费目录');
      const modelPrice = await client.query(`select credit_price,credit_price_unit,credit_price_version from app.model_catalog where id=$1 and visible=true`, [catalogModelId]);
      if (!modelPrice.rowCount || modelPrice.rows[0].credit_price == null) throw new Error('该模型尚未设置用户积分价格，请联系管理员');
      const price = modelPrice.rows[0];
      const units = price.credit_price_unit === 'output' ? quantity : price.credit_price_unit === 'second' ? Math.max(1, Number(metadata.duration) || 1) : price.credit_price_unit === 'thousand_chars' ? Math.max(0.001, String(metadata.prompt || '').length / 1000) : 1;
      const credits = Math.max(0.000001, Number((Number(price.credit_price) * units).toFixed(6)));
      const reservation = await client.query(`select app.reserve_quota($1,'monthly',$2,$3,now()+interval '10 minutes') reservation_id`, [me.workspace_id, credits, idempotencyKey]);
      reservationId = reservation.rows[0].reservation_id;
      metadata.creditPrice = Number(price.credit_price);
      metadata.creditPriceUnit = price.credit_price_unit;
      metadata.creditPriceVersion = Number(price.credit_price_version);
      metadata.credits = credits;
      const row = await client.query(`insert into app.usage_records(workspace_id,user_id,feature_code,provider,model,quantity,unit,result,idempotency_key,request_id,metadata,quota_reservation_id)
        values($1,$2,$3,$4,$5,$6,'request',$7,$8,$9,$10::jsonb,$11)
        on conflict(idempotency_key) do update set metadata=app.usage_records.metadata
        returning id,idempotency_key,result,quota_reservation_id`, [me.workspace_id, me.internal_user_id, String(input.featureCode || 'ai_proxy').slice(0, 120), String(input.provider || '').slice(0, 80) || null, String(input.model || '').slice(0, 160) || null, quantity, result, idempotencyKey, requestId, JSON.stringify(metadata), reservationId]);
      await client.query('commit');
      committed = true;
      return row.rows[0];
    } catch (error) {
      if (!committed) await client.query('rollback');
      throw error;
    } finally { client.release(); }
  }

  async function completeProviderUsage(appwriteUserId, idempotencyKey, result, metadata = {}) {
    const me = await getUser(appwriteUserId);
    if (!me) return false;
    if (!['committed', 'failed', 'unknown'].includes(result)) throw new Error('用量结果状态无效');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.user_id',$1,true)`, [me.internal_user_id]);
      const current = await client.query(`select id,quota_reservation_id,result from app.usage_records where workspace_id=$1 and idempotency_key=$2 for update`, [me.workspace_id, String(idempotencyKey).slice(0, 160)]);
      if (!current.rowCount) { await client.query('rollback'); return false; }
      const row = current.rows[0];
      if (row.result === 'committed' || row.result === 'failed') { await client.query('commit'); return true; }
      if (row.quota_reservation_id && result === 'committed') {
        await client.query(`select app.settle_quota($1,$2)`, [row.quota_reservation_id, `${idempotencyKey}:commit`]);
      } else if (row.quota_reservation_id && result === 'failed') {
        await client.query(`select app.release_quota($1,$2)`, [row.quota_reservation_id, `${idempotencyKey}:release`]);
      }
      const updated = await client.query(`update app.usage_records
        set result=$1,
            completed_at=now(),
            latency_ms=greatest(0, floor(extract(epoch from (now()-occurred_at))*1000))::int,
            metadata=coalesce(metadata,'{}'::jsonb)||$2::jsonb
        where id=$3 returning id`, [result, JSON.stringify(metadata), row.id]);
      await client.query('commit');
      return updated.rowCount === 1;
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function plans() {
    const result = await pool.query(`select p.code,p.name,p.description,p.price_minor,p.billing_interval,
      coalesce((select amount from app.plan_quotas q where q.plan_id=p.id and q.quota_code='monthly'),0) quota_amount,
      coalesce((select jsonb_agg(feature_code order by feature_code) from app.plan_features f where f.plan_id=p.id),'[]') features
      from app.plans p where p.status='active' order by p.price_minor`);
    return result.rows.map(apiPlan);
  }

  async function updatePlan(body = {}) {
    const code = String(body.id || body.code || '').trim();
    if (!code) throw new Error('套餐编号不能为空');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const current = await client.query('select * from app.plans where code=$1 for update', [code]);
      if (!current.rowCount) throw new Error('套餐不存在');
      const old = current.rows[0];
      const oldFeatures = await client.query('select feature_code from app.plan_features where plan_id=$1 order by feature_code', [old.id]);
      const oldQuota = await client.query("select amount from app.plan_quotas where plan_id=$1 and quota_code='monthly'", [old.id]);
      const price = Number.isSafeInteger(Number(body.priceCents)) ? Math.max(0, Number(body.priceCents)) : Number(old.price_minor);
      const days = body.durationDays === undefined ? (old.billing_interval === 'year' ? 365 : old.billing_interval === 'month' ? 30 : 0) : Number(body.durationDays);
      const interval = days >= 365 ? 'year' : days > 0 ? 'month' : 'none';
      const quota = body.monthlyQuota === undefined ? Number(oldQuota.rows[0]?.amount || 0) : Number.isFinite(Number(body.monthlyQuota)) ? Math.max(0, Number(body.monthlyQuota)) : 0;
      const nextVersion = Number(old.version || 1) + 1;
      const features = Array.isArray(body.features) ? body.features.map(x => String(x).slice(0, 120)).filter(Boolean) : oldFeatures.rows.map(x => x.feature_code);
      await client.query(`update app.plans set name=$2,description=$3,price_minor=$4,billing_interval=$5,version=$6,updated_at=now() where id=$1`, [old.id, String(body.name || old.name).slice(0, 120), String(body.description || old.description || ''), price, interval, nextVersion]);
      await client.query(`insert into app.plan_versions(plan_id,version,currency,price_minor,billing_interval,feature_snapshot,quota_snapshot,effective_at)
        values($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,now())`, [old.id, nextVersion, old.currency, price, interval, JSON.stringify(features), JSON.stringify({ monthly: quota })]);
      await client.query('delete from app.plan_features where plan_id=$1', [old.id]);
      for (const feature of features) await client.query('insert into app.plan_features(plan_id,feature_code) values($1,$2)', [old.id, feature]);
      await client.query(`insert into app.plan_quotas(plan_id,quota_code,amount,unit,reset_interval) values($1,'monthly',$2,'credits','month')
        on conflict(plan_id,quota_code) do update set amount=excluded.amount`, [old.id, quota]);
      await client.query('commit');
      return (await plans()).find(p => p.id === code);
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function getSystemSetting(key, fallback = null) {
    const settingKey = String(key || '').trim().slice(0, 120);
    const r = await pool.query('select setting_value from app.system_settings where setting_key=$1', [settingKey]);
    if (r.rowCount) return r.rows[0].setting_value;
    if (fallback !== null) {
      await pool.query(`insert into app.system_settings(setting_key,setting_value) values($1,$2::jsonb) on conflict(setting_key) do nothing`, [settingKey, JSON.stringify(fallback)]);
    }
    return fallback;
  }

  async function setSystemSetting(key, value) {
    const settingKey = String(key || '').trim().slice(0, 120);
    if (!settingKey) throw new Error('设置名称不能为空');
    const r = await pool.query(`insert into app.system_settings(setting_key,setting_value) values($1,$2::jsonb)
      on conflict(setting_key) do update set setting_value=excluded.setting_value,updated_at=now() returning setting_value`, [settingKey, JSON.stringify(value ?? {})]);
    return r.rows[0].setting_value;
  }

  async function applyMembershipPeriod(client, { workspaceId, planId, planVersionId, billingInterval, eventKey, orderId = null, redemptionId = null }) {
    if (!['month', 'year'].includes(billingInterval)) return { applied: false, reason: '套餐没有有效的订阅周期' };
    // 即使当前还没有订阅记录，也先锁工作空间，避免两笔首次付款同时插入而覆盖账期。
    await client.query('select id from app.workspaces where id=$1 for update', [workspaceId]);
    const existing = await client.query(`select id,plan_id,status,current_period_start,current_period_end,billing_anchor_month,billing_anchor_day
      from app.subscriptions where workspace_id=$1 for update`, [workspaceId]);
    const now = new Date();
    const previous = existing.rows[0] || null;
    const active = previous && new Date(previous.current_period_end) > now && ['trialing','active','past_due','paused'].includes(previous.status);
    if (active && previous.plan_id !== planId) {
      return { applied: false, reason: '当前订阅尚未到期，不能直接切换套餐' };
    }
    const periodStart = active ? new Date(previous.current_period_end) : now;
    const anchorMonth = active ? previous.billing_anchor_month : now.getUTCMonth() + 1;
    const anchorDay = active ? previous.billing_anchor_day : now.getUTCDate();
    const periodEnd = addCalendarPeriod(periodStart, billingInterval, anchorMonth, anchorDay);
    const duplicate = await client.query('select 1 from app.subscription_events where idempotency_key=$1', [eventKey]);
    if (duplicate.rowCount) return { applied: true, duplicate: true, periodStart, periodEnd };
    if (previous) {
      await client.query(`update app.subscriptions set plan_id=$2,plan_version_id=$3,status='active',current_period_start=$4,current_period_end=$5,
        billing_anchor_month=$6,billing_anchor_day=$7,billing_timezone='UTC',cancel_at_period_end=false,version=version+1,updated_at=now() where id=$1`,
      [previous.id, planId, planVersionId, active ? previous.current_period_start : periodStart, periodEnd, anchorMonth, anchorDay]);
    } else {
      await client.query(`insert into app.subscriptions(workspace_id,plan_id,plan_version_id,status,current_period_start,current_period_end,billing_anchor_month,billing_anchor_day,billing_timezone)
        values($1,$2,$3,'active',$4,$5,$6,$7,'UTC')`, [workspaceId, planId, planVersionId, periodStart, periodEnd, anchorMonth, anchorDay]);
    }
    await client.query(`insert into app.subscription_events(subscription_id,event_type,idempotency_key,payload)
      select id,$2,$3,$4::jsonb from app.subscriptions where workspace_id=$1
      on conflict(idempotency_key) do nothing`, [workspaceId, active ? 'period_extended' : 'activated', eventKey,
      JSON.stringify({ order_id: orderId, redemption_id: redemptionId, period_start: periodStart.toISOString(), period_end: periodEnd.toISOString(), billing_interval: billingInterval })]);
    return { applied: true, periodStart, periodEnd };
  }

  async function getRenewalStatus(appwriteUserId) {
    const me = await getUser(appwriteUserId);
    if (!me) throw new Error('用户不存在，请重新登录');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('select set_config($1,$2,true)', ['app.user_id', me.internal_user_id]);
      const result = await client.query(`select s.status,s.current_period_end,m.status mandate_status
        from app.subscriptions s left join app.renewal_mandates m on m.subscription_id=s.id and m.status in ('pending','active','revoking')
        where s.workspace_id=$1 order by m.created_at desc limit 1`, [me.workspace_id]);
      await client.query('commit');
      return { automaticRenewalEnabled: false, collectionMode: 'manual', mandateStatus: result.rows[0]?.mandate_status || null,
        subscriptionStatus: result.rows[0]?.status || null, currentPeriodEnd: result.rows[0]?.current_period_end ? new Date(result.rows[0].current_period_end).getTime() : null };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function createOrder(appwriteUserId, planCode, idempotencyKey, paymentMethod = "mock") {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const me = await getUser(appwriteUserId);
      if (!me) throw new Error("用户不存在，请重新登录");
      await client.query('select id from app.workspaces where id=$1 for update', [me.workspace_id]);
      const plan = await client.query(`select p.*,v.id plan_version_id from app.plans p join app.plan_versions v on v.plan_id=p.id and v.version=p.version where p.code=$1 and p.status='active'`, [planCode]);
      if (!plan.rowCount) throw new Error("套餐不存在");
      const p = plan.rows[0];
      const currentSubscription = await client.query(`select s.plan_id,s.current_period_end,cp.code current_plan_code from app.subscriptions s join app.plans cp on cp.id=s.plan_id where s.workspace_id=$1 for update`, [me.workspace_id]);
      if (currentSubscription.rowCount && new Date(currentSubscription.rows[0].current_period_end) > new Date() && currentSubscription.rows[0].current_plan_code !== planCode) {
        throw new Error('当前订阅尚未到期，不能直接切换套餐');
      }
      const existing = await client.query(`select o.*,u.appwrite_user_id,p.code plan_code,coalesce(pay.provider,'') payment_provider,pay.provider_payment_id,pay.paid_at
        from app.orders o join app.workspaces w on w.id=o.workspace_id join app.user_accounts u on u.id=w.owner_user_id join app.plans p on p.id=o.plan_id
        left join lateral (select * from app.payments x where x.order_id=o.id order by x.created_at desc limit 1) pay on true
        where o.workspace_id=$1 and o.idempotency_key=$2`, [me.workspace_id, idempotencyKey]);
      if (existing.rowCount) {
        if (existing.rows[0].plan_code !== planCode) throw new Error("幂等键已用于其他套餐，不能复用");
        await client.query("commit");
        return apiOrder(existing.rows[0]);
      }
      const order = await client.query(`insert into app.orders(workspace_id,plan_id,plan_version_id,order_no,status,currency,amount_minor,idempotency_key,price_snapshot)
        values($1,$2,$3,'QY-'||replace(gen_random_uuid()::text,'-',''),'pending',$4,$5,$6,$7::jsonb)
        on conflict(idempotency_key) do nothing returning id`, [me.workspace_id, p.id, p.plan_version_id, p.currency, p.price_minor, idempotencyKey, JSON.stringify({ code: p.code, version: p.version })]);
      if (!order.rowCount) {
        const conflict = await client.query(`select o.*,u.appwrite_user_id,p.code plan_code,coalesce(pay.provider,'') payment_provider,pay.provider_payment_id,pay.paid_at
          from app.orders o join app.workspaces w on w.id=o.workspace_id join app.user_accounts u on u.id=w.owner_user_id join app.plans p on p.id=o.plan_id
          left join lateral (select * from app.payments x where x.order_id=o.id order by x.created_at desc limit 1) pay on true
          where o.idempotency_key=$1`, [idempotencyKey]);
        if (!conflict.rowCount) throw new Error("订单创建冲突，请稍后重试");
        if (conflict.rows[0].workspace_id !== me.workspace_id) throw new Error("幂等键已被其他空间占用");
        if (conflict.rows[0].plan_code !== planCode) throw new Error("幂等键已用于其他套餐，不能复用");
        await client.query("commit");
        return apiOrder(conflict.rows[0]);
      }
      const row = await client.query(`select o.*,u.appwrite_user_id,p.code plan_code,'' payment_provider,null provider_payment_id,null paid_at from app.orders o join app.workspaces w on w.id=o.workspace_id join app.user_accounts u on u.id=w.owner_user_id join app.plans p on p.id=o.plan_id where o.id=$1`, [order.rows[0].id]);
      await client.query("commit");
      return apiOrder(row.rows[0]);
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }

  async function payOrder(appwriteUserId, orderId) {
    if (paymentMode !== 'mock') throw new Error('支付渠道尚未配置，订单已创建但不能确认付款');
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
      const paid = await client.query(`insert into app.payments(order_id,provider,status,amount_minor,currency,paid_at,raw_reference)
        values($1,'mock','succeeded',$2,$3,now(),'{}') returning id,paid_at`, [order.id, order.amount_minor, order.currency]);
      await client.query(`update app.orders set status='paid',updated_at=now() where id=$1`, [order.id]);
      const membership = await applyMembershipPeriod(client, { workspaceId: order.workspace_id, planId: order.plan_id, planVersionId: order.plan_version_id,
        billingInterval: order.billing_interval, eventKey: `order:${order.id}:membership-period`, orderId: order.id });
      if (!membership.applied) throw new Error(membership.reason);
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
  async function createRefundRequest(appwriteUserId, input = {}) {
    const orderId = String(input.orderId || '').trim();
    const amount = Math.floor(Number(input.amountCents || 0));
    const reason = String(input.reason || '').trim();
    const idempotencyKey = String(input.idempotencyKey || `refund:${crypto.randomUUID()}`).slice(0, 160);
    if (!orderId || !Number.isSafeInteger(amount) || amount <= 0 || !reason) throw new Error('退款订单、金额和原因不能为空');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const me = await getUser(appwriteUserId);
      if (!me) throw new Error('用户不存在，请重新登录');
      const existing = await client.query(`select r.id,r.order_id,r.amount_minor,r.status,r.idempotency_key,r.created_at from app.refunds r where r.workspace_id=$1 and r.idempotency_key=$2`, [me.workspace_id, idempotencyKey]);
      if (existing.rowCount) { await client.query('commit'); return { id: existing.rows[0].id, orderId: existing.rows[0].order_id, amountCents: Number(existing.rows[0].amount_minor), status: existing.rows[0].status, idempotencyKey: existing.rows[0].idempotency_key, createdAt: new Date(existing.rows[0].created_at).getTime() }; }
      const requestedPaymentId = input.paymentId ? String(input.paymentId).trim() : null;
      if (requestedPaymentId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedPaymentId)) throw new Error('指定的收款编号无效');
      const refundKind = String(input.refundKind || 'purchase_refund');
      if (!['purchase_refund','duplicate_collection'].includes(refundKind)) throw new Error('退款类型不正确');
      const order = await client.query(`select o.id,o.workspace_id,o.amount_minor,o.currency,o.status,pay.id payment_id,pay.amount_minor receipt_amount,pay.currency receipt_currency,pay.is_duplicate,pay.receipt_count
        from app.orders o join app.workspaces w on w.id=o.workspace_id and w.owner_user_id=(select id from app.user_accounts where appwrite_user_id=$1)
        left join lateral(
          select x.id,x.amount_minor,x.currency,
            x.id<>(select first_receipt.id from app.payments first_receipt where first_receipt.order_id=o.id and first_receipt.status='succeeded' order by first_receipt.paid_at asc nulls last,first_receipt.created_at asc,first_receipt.id asc limit 1) is_duplicate,
            (select count(*) from app.payments counted where counted.order_id=o.id and counted.status='succeeded') receipt_count
          from app.payments x where x.order_id=o.id and x.status='succeeded'
            and x.id=coalesce($3::uuid,(select first_receipt.id from app.payments first_receipt where first_receipt.order_id=o.id and first_receipt.status='succeeded' order by first_receipt.paid_at asc nulls last,first_receipt.created_at asc,first_receipt.id asc limit 1))
          for update of x
        ) pay on true
        where o.id=$2 for update of o,w`, [appwriteUserId, orderId, requestedPaymentId]);
      if (!order.rowCount || !['paid','partially_refunded','refunded'].includes(order.rows[0].status) || !order.rows[0].payment_id) throw new Error('订单不存在或尚未确认支付');
      if ((refundKind === 'duplicate_collection') !== Boolean(order.rows[0].is_duplicate)) throw new Error('退款类型必须与所选收款记录相符');
      const used = await client.query(`select coalesce(sum(amount_minor) filter(where status in ('pending','processing','succeeded','unknown')),0) used from app.refunds where payment_id=$1`, [order.rows[0].payment_id]);
      const remaining = Number(order.rows[0].receipt_amount) - Number(used.rows[0].used);
      if (amount > remaining) throw new Error('退款金额超过可退金额');
      const row = await client.query(`insert into app.refunds(workspace_id,order_id,payment_id,refund_kind,amount_minor,currency,idempotency_key,reason,requested_by)
        values($1,$2,$3,$4,$5,$6,$7,$8,(select id from app.user_accounts where appwrite_user_id=$9)) returning id,created_at`, [me.workspace_id, orderId, order.rows[0].payment_id, refundKind, amount, order.rows[0].receipt_currency, idempotencyKey, reason, appwriteUserId]);
      await client.query('commit');
      return { id: row.rows[0].id, orderId, paymentId: order.rows[0].payment_id, refundKind, currency: order.rows[0].receipt_currency, amountCents: amount, status: 'pending', idempotencyKey, createdAt: new Date(row.rows[0].created_at).getTime() };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }
  async function listRefunds(appwriteUserId) {
    const me = await getUser(appwriteUserId); if (!me) return [];
    const r = await pool.query(`select r.id,r.order_id,r.payment_id,r.refund_kind,r.amount_minor,r.currency,r.status,r.reason,r.provider_refund_id,r.idempotency_key,r.created_at,r.completed_at,o.order_no
      from app.refunds r join app.orders o on o.id=r.order_id where r.workspace_id=$1 order by r.created_at desc`, [me.workspace_id]);
    return r.rows.map(x => ({ id:x.id, orderId:x.order_id, orderNo:x.order_no, paymentId:x.payment_id, refundKind:x.refund_kind, currency:x.currency, amountCents:Number(x.amount_minor), status:x.status, reason:x.reason, providerRefundId:x.provider_refund_id||'', idempotencyKey:x.idempotency_key, createdAt:new Date(x.created_at).getTime(), completedAt:x.completed_at?new Date(x.completed_at).getTime():null }));
  }
  async function adminRefunds() {
    const r = await pool.query(`select r.id,r.workspace_id,r.order_id,r.payment_id,r.refund_kind,r.amount_minor,r.currency,r.status,r.reason,r.provider_refund_id,r.idempotency_key,r.created_at,r.completed_at,o.order_no,u.appwrite_user_id,u.email
      from app.refunds r join app.orders o on o.id=r.order_id join app.user_accounts u on u.id=(select owner_user_id from app.workspaces where id=r.workspace_id) order by r.created_at desc limit 1000`);
    return r.rows.map(x => ({ id:x.id, workspaceId:x.workspace_id, orderId:x.order_id, orderNo:x.order_no, paymentId:x.payment_id, refundKind:x.refund_kind, userId:x.appwrite_user_id, email:x.email||'', currency:x.currency, amountCents:Number(x.amount_minor), status:x.status, reason:x.reason, providerRefundId:x.provider_refund_id||'', idempotencyKey:x.idempotency_key, createdAt:new Date(x.created_at).getTime(), completedAt:x.completed_at?new Date(x.completed_at).getTime():null }));
  }
  async function adminUpdateRefund(id, input = {}) {
    const status=String(input.status||''); const providerRefundId=String(input.providerRefundId||'').trim();
    if (!['processing','succeeded','failed','unknown'].includes(status)) throw new Error('不支持的退款状态');
    if (status==='succeeded' && !providerRefundId) throw new Error('退款成功必须提供供应商退款单号');
    const client=await pool.connect();
    try { await client.query('begin');
      const cur=await client.query(`select r.*,o.amount_minor order_amount from app.refunds r join app.orders o on o.id=r.order_id where r.id=$1 for update`,[id]);
      if(!cur.rowCount) throw new Error('退款申请不存在'); const row=cur.rows[0];
      if(status==='processing' && !['pending','unknown'].includes(row.status)) throw new Error('当前退款状态不能进入处理中');
      if(['succeeded','failed','unknown'].includes(status) && !['pending','processing','unknown'].includes(row.status)) throw new Error('该退款申请已经结束，不能重复处理');
      await client.query(`update app.refunds set status=$1,provider_refund_id=coalesce($2,provider_refund_id),completed_at=case when $1 in ('succeeded','failed') then now() else completed_at end,raw_reference=raw_reference||$3::jsonb where id=$4`,[status,providerRefundId||null,JSON.stringify({note:String(input.note||'').slice(0,1000)}),id]);
      if(status==='succeeded') { const totals=await client.query(`select coalesce((select sum(amount_minor) from app.refunds where order_id=$1 and status='succeeded'),0) refunded,coalesce((select sum(amount_minor) from app.payments where order_id=$1 and status='succeeded'),0) collected`,[row.order_id]); const refunded=Number(totals.rows[0].refunded),collected=Number(totals.rows[0].collected); const next=refunded>=collected?'refunded':refunded>0?'partially_refunded':'paid'; await client.query(`update app.orders set status=$1,updated_at=now() where id=$2 and status in ('paid','partially_refunded')`,[next,row.order_id]); }
      await client.query('commit'); return {id,status};
    } catch(error){await client.query('rollback');throw error;} finally{client.release();}
  }
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

  // ---------------- 电子发票申请 ----------------
  async function createInvoiceRequest(appwriteUserId, input = {}) {
    const titleType = input.titleType === "company" ? "company" : "personal";
    const titleName = String(input.titleName || "").trim();
    const taxNo = String(input.taxNo || "").trim();
    const email = String(input.email || "").trim();
    const orderIds = Array.isArray(input.orderIds) ? input.orderIds.map(String) : [];
    if (!titleName) throw new Error("请填写发票抬头");
    if (titleType === "company" && !taxNo) throw new Error("企业抬头需要填写税号");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("请填写正确的收票邮箱");
    if (!orderIds.length) throw new Error("请至少选择一笔已支付订单");

    const client = await pool.connect();
    try {
      await client.query("begin");
      const me = await client.query(`select u.id,w.id workspace_id from app.user_accounts u join app.workspaces w on w.owner_user_id=u.id and w.type='personal' and w.status='active' where u.appwrite_user_id=$1 and u.status='active'`, [appwriteUserId]);
      if (!me.rowCount) throw new Error("用户不存在，请重新登录");
      const userId = me.rows[0].id;

      const orders = await client.query(
        `select o.id,o.order_no,o.amount_minor from app.orders o
         join app.workspaces w on w.id=o.workspace_id
         where o.id = ANY($1::uuid[]) and w.owner_user_id=$2 and o.status='paid'`,
        [orderIds, userId]
      );
      if (orders.rows.length !== orderIds.length) throw new Error("所选订单不存在或不可开票");
      const taken = await client.query(`select order_id from app.invoice_request_orders where order_id = ANY($1::uuid[])`, [orderIds]);
      if (taken.rowCount) throw new Error("所选订单中已有部分申请过发票，不能重复申请");

      const totalMinor = orders.rows.reduce((s, o) => s + Number(o.amount_minor), 0);
      const req = await client.query(
        `insert into app.invoice_requests(user_id,workspace_id,title_type,title_name,tax_no,email,total_minor)
         values($1,$2,$3,$4,$5,$6,$7) returning id,status,created_at`,
        [userId, me.rows[0].workspace_id, titleType, titleName, titleType === "company" ? taxNo : null, email, totalMinor]
      );
      const requestId = req.rows[0].id;
      for (const o of orders.rows) {
        await client.query(
          `insert into app.invoice_request_orders(request_id,order_id,order_no,amount_minor) values($1,$2,$3,$4)`,
          [requestId, o.id, o.order_no, Number(o.amount_minor)]
        );
      }
      await client.query("commit");
      return { id: requestId, status: "pending", totalCents: totalMinor, orderCount: orders.rows.length, createdAt: new Date(req.rows[0].created_at).getTime() };
    } catch (e) { await client.query("rollback"); throw e; } finally { client.release(); }
  }

  async function listMyInvoiceRequests(appwriteUserId) {
    const me = await getUser(appwriteUserId);
    if (!me) return [];
    const r = await pool.query(
      `select r.id,r.title_type,r.title_name,r.tax_no,r.email,r.total_minor,r.status,r.pdf_url,r.reject_reason,r.created_at,r.completed_at,
        (select json_agg(json_build_object('orderId',ro.order_id,'orderNo',ro.order_no,'amountCents',ro.amount_minor)
          order by ro.order_no) from app.invoice_request_orders ro where ro.request_id=r.id) orders
       from app.invoice_requests r where r.user_id=$1 and r.workspace_id=$2 order by r.created_at desc`,
      [me.internal_user_id, me.workspace_id]
    );
    return r.rows.map(x => ({
      id: x.id, titleType: x.title_type, titleName: x.title_name, taxNo: x.tax_no || "",
      email: x.email, totalCents: Number(x.total_minor), status: x.status, pdfUrl: x.pdf_url || "",
      rejectReason: x.reject_reason || "", createdAt: new Date(x.created_at).getTime(),
      completedAt: x.completed_at ? new Date(x.completed_at).getTime() : null,
      orders: x.orders || [],
    }));
  }

  async function adminListInvoiceRequests() {
    const r = await pool.query(
      `select r.id,r.title_type,r.title_name,r.tax_no,r.email,r.total_minor,r.status,r.pdf_url,r.reject_reason,r.created_at,r.completed_at,
        u.appwrite_user_id,u.email user_email,
        (select json_agg(json_build_object('orderId',ro.order_id,'orderNo',ro.order_no,'amountCents',ro.amount_minor) order by ro.order_no) from app.invoice_request_orders ro where ro.request_id=r.id) orders
       from app.invoice_requests r join app.user_accounts u on u.id=r.user_id order by r.created_at desc limit 500`
    );
    return r.rows.map(x => ({
      id: x.id, titleType: x.title_type, titleName: x.title_name, taxNo: x.tax_no || "",
      email: x.email, userEmail: x.user_email, totalCents: Number(x.total_minor), status: x.status,
      pdfUrl: x.pdf_url || "", rejectReason: x.reject_reason || "", createdAt: new Date(x.created_at).getTime(),
      completedAt: x.completed_at ? new Date(x.completed_at).getTime() : null, orders: x.orders || [],
    }));
  }

  async function adminUpdateInvoiceRequest(id, input = {}) {
    const status = String(input.status || "");
    if (!["processing", "completed", "failed"].includes(status)) throw new Error("不支持的发票状态");
    const client = await pool.connect();
    try {
      await client.query("begin");
      const cur = await client.query(`select id,status from app.invoice_requests where id=$1 for update`, [id]);
      if (!cur.rowCount) throw new Error("发票申请不存在");
      const currentStatus = cur.rows[0].status;
      if (status === "processing" && currentStatus !== "pending") throw new Error("只有待处理申请可以进入开票中");
      if (["completed", "failed"].includes(status) && !["pending", "processing"].includes(currentStatus)) throw new Error("该发票申请已经结束，不能重复处理");
      const pdfUrl = status === "completed" ? String(input.pdfUrl || "").trim() : null;
      if (status === "completed" && !pdfUrl) throw new Error("标记完成时需要提供电子发票 PDF 地址");
      const rejectReason = status === "failed" ? String(input.rejectReason || "").trim() : null;
      await client.query(
        `update app.invoice_requests set status=$1,pdf_url=coalesce($2,pdf_url),reject_reason=coalesce($3,reject_reason),
         completed_at=case when $1 in ('completed','failed') then now() else completed_at end where id=$4`,
        [status, pdfUrl || null, rejectReason || null, id]
      );
      await client.query("commit");
      return { id, status };
    } catch (e) { await client.query("rollback"); throw e; } finally { client.release(); }
  }

  async function adminUnknownUsage() {
    const r = await pool.query(`select id,workspace_id,user_id,provider,model,request_id,quantity,unit,occurred_at
      from app.usage_records where result='unknown' order by occurred_at desc,id desc limit 200`);
    return r.rows;
  }

  async function adminReconcileUsage(usageId, actor, input = {}) {
    const r = await pool.query(`select app.reconcile_provider_usage($1,$2,$3,$4,$5) id`,
      [usageId, actor, input.decision, input.reason, input.providerReference]);
    return { reconciliationId: r.rows[0].id, usageId, decision: input.decision };
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

  // 只读核对账户数字与不可变额度流水；发现差异时只报告，不自动覆盖余额。
  async function adminQuotaAudit() {
    const r = await pool.query(`
      select q.id,q.workspace_id,q.quota_code,q.granted,q.reserved,q.consumed,q.available,
        coalesce(sum(case when l.entry_type in ('grant','refund') then l.amount
          when l.entry_type='adjustment' and (l.metadata->>'delta') ~ '^-?[0-9]+([.][0-9]+)?$' and (l.metadata->>'delta')::numeric > 0 then (l.metadata->>'delta')::numeric else 0 end),0) ledger_granted,
        coalesce(sum(case when l.entry_type='reserve' then l.amount when l.entry_type in ('commit','release','expire') then -l.amount else 0 end),0) ledger_reserved,
        coalesce(sum(case when l.entry_type='commit' then l.amount when l.entry_type='adjustment' and (l.metadata->>'delta') ~ '^-?[0-9]+([.][0-9]+)?$' and (l.metadata->>'delta')::numeric < 0 then abs((l.metadata->>'delta')::numeric) else 0 end),0) ledger_consumed
      from app.quota_accounts q left join app.quota_ledger l on l.account_id=q.id and l.workspace_id=q.workspace_id
      group by q.id,q.workspace_id,q.quota_code,q.granted,q.reserved,q.consumed,q.available
      order by q.updated_at desc`);
    return r.rows.map(x => {
      const current = { granted: Number(x.granted), reserved: Number(x.reserved), consumed: Number(x.consumed), available: Number(x.available) };
      const ledger = { granted: Number(x.ledger_granted), reserved: Number(x.ledger_reserved), consumed: Number(x.ledger_consumed) };
      const differences = { granted: current.granted - ledger.granted, reserved: current.reserved - ledger.reserved, consumed: current.consumed - ledger.consumed };
      return { accountId: x.id, workspaceId: x.workspace_id, quotaCode: x.quota_code, current, ledger, differences, consistent: Object.values(differences).every(value => Math.abs(value) < 0.000001) && Math.abs(current.available - (current.granted - current.reserved - current.consumed)) < 0.000001 };
    });
  }

  async function recordPaymentEvent(provider, input = {}) {
    const providerEventId = String(input.eventId || input.id || '').trim().slice(0, 200);
    const eventType = String(input.type || input.eventType || '').trim().slice(0, 120);
    if (!providerEventId || !eventType) throw new Error('支付事件缺少事件编号或事件类型');
    const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '')) ? String(value) : null;
    const orderId = uuid(input.orderId);
    const amount = input.amountMinor == null ? null : Number(input.amountMinor);
    if (amount != null && (!Number.isSafeInteger(amount) || amount < 0)) throw new Error('支付事件金额无效');
    const providerName = String(provider).slice(0,64);
    let row = await pool.query(`insert into app.payment_events(provider,provider_event_id,event_type,order_id,payment_id,amount_minor,currency,payload,signature_verified)
      values($1,$2,$3,$4,null,$5,$6,$7::jsonb,true)
      on conflict(provider,provider_event_id) do nothing returning id,status,received_at`, [providerName, providerEventId, eventType, orderId, amount, String(input.currency || '').slice(0,3) || null, JSON.stringify(input)]);
    const duplicate = !row.rowCount;
    if (duplicate) {
      row = await pool.query(`select id,status,received_at,next_retry_at,attempt_count from app.payment_events where provider=$1 and provider_event_id=$2`, [providerName, providerEventId]);
      if (!row.rowCount) throw new Error('支付事件保存后无法读取');
      const existing = row.rows[0];
      if (!['received','failed'].includes(existing.status) || (existing.status === 'failed' && (!existing.next_retry_at || Number(existing.attempt_count) >= 8)) || (existing.next_retry_at && new Date(existing.next_retry_at) > new Date())) {
        return { eventId: existing.id, providerEventId, status: existing.status, duplicate: true };
      }
    }
    let processed;
    try { processed = await processPaymentEvent(providerName, providerEventId); }
    catch (error) {
      await schedulePaymentEventRetry(providerName, providerEventId, error);
      const current = await pool.query(`select id,status,attempt_count,next_retry_at from app.payment_events where provider=$1 and provider_event_id=$2`, [providerName, providerEventId]);
      return { eventId: current.rows[0]?.id, providerEventId, status: current.rows[0]?.status || 'failed', duplicate, error: error.message };
    }
    return { eventId: row.rows[0].id, providerEventId, status: processed.status, duplicate, receivedAt: new Date(row.rows[0].received_at).toISOString(), error: processed.error || null, paymentId: processed.paymentId || null, duplicateCollection: Boolean(processed.duplicateCollection) };
  }

  async function schedulePaymentEventRetry(provider, providerEventId, error) {
    const failed = await pool.query(`update app.payment_events
      set status='failed',attempt_count=attempt_count+case when status='processing' then 0 else 1 end,last_attempt_at=now(),
          next_retry_at=case when attempt_count+case when status='processing' then 0 else 1 end < 8 then now()+make_interval(secs=>least(3600,(30*power(2,least(attempt_count,7)))::integer)) else null end,
          error_message=$3
      where provider=$1 and provider_event_id=$2 and status not in ('processed','ignored','review')
      returning id,attempt_count,next_retry_at`, [String(provider).slice(0,64), String(providerEventId).slice(0,200), String(error?.message || error || '支付事件处理失败').slice(0,2000)]);
    if (failed.rowCount && !failed.rows[0].next_retry_at) {
      await pool.query(`select app.record_payment_alert('payment_event_retry_exhausted','critical',w.id,'支付通知多次处理失败，已停止自动重试',jsonb_build_object('event_id',pe.id,'provider',pe.provider,'provider_event_id',pe.provider_event_id,'attempt_count',pe.attempt_count,'error',pe.error_message))
        from app.payment_events pe left join app.orders o on o.id=pe.order_id left join app.workspaces w on w.id=o.workspace_id where pe.id=$1`, [failed.rows[0].id]);
    }
  }

  async function flagPaymentEventForReview(client, event, message, order = null, paymentId = null) {
    const receipt = paymentId ? await client.query(`select amount_minor,currency,provider_payment_id from app.payments where id=$1`, [paymentId]) : { rows: [] };
    const receiptDetails = receipt.rows[0] ? { amountMinor: Number(receipt.rows[0].amount_minor), currency: receipt.rows[0].currency, providerPaymentId: receipt.rows[0].provider_payment_id } : {};
    await client.query(`update app.payment_events set payment_id=coalesce($1,payment_id),status='review',next_retry_at=null,error_message=$2 where id=$3`, [paymentId, message, event.id]);
    await client.query(`select app.record_payment_alert('payment_event_review','critical',$1,'支付通知需要人工核对',jsonb_build_object('event_id',$2::uuid,'provider',$3::text,'provider_event_id',$4::text,'order_id',$5::uuid,'payment_id',$6::uuid,'reason',$7::text,'receipt',$8::jsonb))`,
      [order?.workspace_id || null, event.id, event.provider, event.provider_event_id, event.order_id, paymentId, message, JSON.stringify(receiptDetails)]);
  }

  // 将已经验签的支付事件幂等地推进到订单、支付记录、订阅和额度。
  // 任何金额、币种或订单关系不一致都只记录失败，不发放权益。
  async function processPaymentEvent(provider, providerEventId) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const eventResult = await client.query(`select * from app.payment_events where provider=$1 and provider_event_id=$2 for update`, [String(provider).slice(0,64), String(providerEventId).slice(0,200)]);
      if (!eventResult.rowCount) throw new Error('支付事件不存在');
      const event = eventResult.rows[0];
      if (['processed','ignored','review'].includes(event.status)) { await client.query('commit'); return { status: event.status, error: event.error_message || null }; }
      if (event.status !== 'processing') {
        await client.query(`update app.payment_events set status='processing',attempt_count=attempt_count+1,last_attempt_at=now(),next_retry_at=null where id=$1`, [event.id]);
      }
      const eventType = String(event.event_type || '').toLowerCase();
      const successTypes = new Set(['payment.succeeded','payment.paid','trade.success','succeeded','paid']);
      if (!successTypes.has(eventType)) {
        await client.query(`update app.payment_events set status='ignored',processed_at=now(),error_message=$1 where id=$2`, ['非支付成功事件，不发放权益', event.id]);
        await client.query('commit');
        return { status: 'ignored', error: '非支付成功事件，不发放权益' };
      }
      if (!event.order_id || event.amount_minor == null || Number(event.amount_minor) <= 0) {
        const message = '支付事件缺少订单或金额，等待人工核对';
        await flagPaymentEventForReview(client, event, message);
        await client.query('commit');
        return { status: 'review', error: message };
      }
      const orderResult = await client.query(`select o.*,p.code plan_code,p.name plan_name,p.billing_interval,v.quota_snapshot,u.appwrite_user_id
        from app.orders o join app.workspaces w on w.id=o.workspace_id
        join app.user_accounts u on u.id=w.owner_user_id
        join app.plans p on p.id=o.plan_id join app.plan_versions v on v.id=o.plan_version_id
        where o.id=$1 for update`, [event.order_id]);
      if (!orderResult.rowCount) {
        const message = '支付事件关联的订单不存在，等待人工核对';
        await flagPaymentEventForReview(client, event, message);
        await client.query('commit');
        return { status: 'review', error: message };
      }
      const order = orderResult.rows[0];
      const providerPaymentId = String(event.payload?.providerPaymentId || event.payload?.transactionId || event.payload?.tradeNo || `${provider}:${providerEventId}`).slice(0,160);
      const rawCurrency = String(event.currency || order.currency).trim().toUpperCase();
      const receiptCurrency = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : 'XXX';
      let payment = await client.query(`insert into app.payments(order_id,provider,provider_payment_id,status,amount_minor,currency,paid_at,raw_reference)
        values($1,$2,$3,'succeeded',$4,$5,now(),$6::jsonb)
        on conflict(provider,provider_payment_id) do nothing returning id,order_id,amount_minor,currency`, [order.id, String(provider).slice(0,64), providerPaymentId, event.amount_minor, receiptCurrency, JSON.stringify(event.payload || {})]);
      const newReceipt = payment.rowCount === 1;
      if (!payment.rowCount) {
        payment = await client.query(`select id,order_id,amount_minor,currency from app.payments where provider=$1 and provider_payment_id=$2 for update`, [String(provider).slice(0,64), providerPaymentId]);
        if (!payment.rowCount || payment.rows[0].order_id !== order.id) {
          const message = '支付平台交易号已经绑定其他订单，拒绝发放权益';
          await flagPaymentEventForReview(client, event, message, order);
          await client.query('commit');
          return { status: 'review', error: message };
        }
      }
      if (Number(payment.rows[0].amount_minor) !== Number(event.amount_minor) || payment.rows[0].currency !== receiptCurrency) {
        const message = '同一支付平台交易号返回了不同金额或币种，已保留原收款并转人工核对';
        await flagPaymentEventForReview(client, event, message, order, payment.rows[0].id);
        await client.query('commit');
        return { status: 'review', paymentId: payment.rows[0].id, error: message };
      }
      if (order.status === 'paid' || order.status === 'partially_refunded' || order.status === 'refunded') {
        if (!newReceipt) {
          await client.query(`update app.payment_events set payment_id=$1,status='processed',processed_at=coalesce(processed_at,now()),next_retry_at=null,error_message=null where id=$2`, [payment.rows[0].id, event.id]);
          await client.query('commit');
          return { status: 'processed', paymentId: payment.rows[0].id, orderId: order.id, alreadyPaid: true };
        }
        const message = '同一订单检测到多笔实收；已保存收款记录，不重复发放权益，请核对并处理退款';
        const automaticRefund = await client.query(`insert into app.refunds(workspace_id,order_id,payment_id,refund_kind,amount_minor,currency,idempotency_key,reason)
          values($1,$2,$3,'duplicate_collection',$4,$5,$6,'系统检测到同一订单重复收款，已建立退回这笔重复收款的待处理申请')
          on conflict(idempotency_key) do nothing returning id`, [order.workspace_id, order.id, payment.rows[0].id, payment.rows[0].amount_minor, payment.rows[0].currency, `duplicate-payment:${payment.rows[0].id}`]);
        const refund = automaticRefund.rows[0] || (await client.query(`select id from app.refunds where idempotency_key=$1`, [`duplicate-payment:${payment.rows[0].id}`])).rows[0];
        if (order.status === 'refunded') await client.query(`update app.orders set status='partially_refunded',updated_at=now() where id=$1`, [order.id]);
        await client.query(`update app.payment_events set payment_id=$1,status='processed',processed_at=coalesce(processed_at,now()),error_message=$2 where id=$3`, [payment.rows[0].id, message, event.id]);
        await client.query(`select app.record_payment_alert('payment_duplicate_collection','critical',$1,'检测到同一订单多笔实收，已建立待处理退款申请',jsonb_build_object('order_id',$2::uuid,'payment_id',$3::uuid,'payment_event_id',$4::uuid,'refund_id',$5::uuid,'provider',$6::text,'provider_payment_id',$7::text))`, [order.workspace_id, order.id, payment.rows[0].id, event.id, refund?.id || null, String(provider).slice(0,64), providerPaymentId]);
        await client.query('commit');
        return { status: 'processed', paymentId: payment.rows[0].id, refundId: refund?.id || null, orderId: order.id, alreadyPaid: true, duplicateCollection: true, error: message };
      }
      if (order.status !== 'pending') {
        const message = `订单当前状态为 ${order.status}，已记录实收，不能自动发放权益`;
        await flagPaymentEventForReview(client, event, message, order, payment.rows[0].id);
        await client.query(`select app.record_payment_alert('payment_for_closed_order','critical',$1,'已关闭订单收到付款，需要人工核对',jsonb_build_object('order_id',$2::uuid,'payment_id',$3::uuid,'payment_event_id',$4::uuid,'order_status',$5::text))`, [order.workspace_id, order.id, payment.rows[0].id, event.id, order.status]);
        await client.query('commit');
        return { status: 'review', paymentId: payment.rows[0].id, orderId: order.id, error: message };
      }
      if (Number(event.amount_minor) !== Number(order.amount_minor) || receiptCurrency !== String(order.currency).toUpperCase()) {
        const message = '支付事件金额或币种与订单不一致；已按实收金额留账，需人工核对，未发放权益';
        await flagPaymentEventForReview(client, event, message, order, payment.rows[0].id);
        await client.query('commit');
        return { status: 'review', paymentId: payment.rows[0].id, orderId: order.id, error: message };
      }
      const membership = await applyMembershipPeriod(client, { workspaceId: order.workspace_id, planId: order.plan_id, planVersionId: order.plan_version_id,
        billingInterval: order.billing_interval, eventKey: `order:${order.id}:membership-period`, orderId: order.id });
      if (!membership.applied) {
        const message = `${membership.reason}；款项已收妥并保留收款记录，转人工核对，不自动切换权益`;
        await flagPaymentEventForReview(client, event, message, order, payment.rows[0].id);
        await client.query(`select app.record_payment_alert('payment_subscription_conflict','critical',$1,$2,jsonb_build_object('order_id',$3::uuid,'payment_id',$4::uuid,'payment_event_id',$5::uuid))`,
          [order.workspace_id, message, order.id, payment.rows[0].id, event.id]);
        await client.query('commit');
        return { status: 'review', paymentId: payment.rows[0].id, orderId: order.id, error: message };
      }
      await client.query(`update app.orders set status='paid',updated_at=now() where id=$1`, [order.id]);
      const quota = Number(order.quota_snapshot?.monthly || 0);
      if (quota > 0) {
        const account = await client.query(`insert into app.quota_accounts(workspace_id,quota_code) values($1,'monthly') on conflict(workspace_id,quota_code) do update set updated_at=now() returning id`, [order.workspace_id]);
        await client.query(`update app.quota_accounts set granted=granted+$1,version=version+1,updated_at=now() where id=$2`, [quota, account.rows[0].id]);
        await client.query(`insert into app.quota_ledger(account_id,workspace_id,entry_type,amount,idempotency_key,metadata) values($1,$2,'grant',$3,$4,$5::jsonb) on conflict do nothing`, [account.rows[0].id, order.workspace_id, quota, `grant:order:${order.id}`, JSON.stringify({ order_id: order.id, payment_event_id: event.id })]);
      }
      await client.query(`update app.payment_events set payment_id=$1,status='processed',processed_at=now(),next_retry_at=null,error_message=null where id=$2`, [payment.rows[0].id, event.id]);
      await client.query('commit');
      return { status: 'processed', paymentId: payment.rows[0].id, orderId: order.id };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
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
        const membership = await applyMembershipPeriod(client, { workspaceId: user.rows[0].workspace_id, planId: item.plan_id, planVersionId: item.plan_version_id,
          billingInterval: item.billing_interval, eventKey: `redemption:${item.id}:membership-period`, redemptionId: item.id });
        if (!membership.applied) throw new Error(membership.reason);
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
    const masked = row.api_key_ciphertext ? maskApiKey(decryptApiKey(row.api_key_ciphertext).apiKey) : maskApiKey(String(row.api_key || ''));
    return {
      id: row.id,
      name: row.name,
      provider: row.provider,
      base_url: row.base_url,
      api_key_masked: masked,
      model: row.model || '',
      max_concurrency: row.max_concurrency === null ? null : Number(row.max_concurrency),
      is_active: row.is_active === true ? 1 : 0,
      created_at: new Date(row.created_at).getTime(),
      updated_at: new Date(row.updated_at).getTime(),
    };
  }

  function platformApiKeyRuntimeView(row) {
    return {
      ...platformApiKeyView(row),
      api_key: row.api_key_ciphertext ? decryptApiKey(row.api_key_ciphertext).apiKey : String(row.api_key || ''),
    };
  }

  async function reencryptPlatformApiKeyIfNeeded(row, executor = pool) {
    if (!row.api_key_ciphertext) return String(row.api_key || '');
    const decrypted = decryptApiKey(row.api_key_ciphertext);
    if (decrypted.needsReEncryption) {
      const rotated = encryptApiKey(decrypted.apiKey);
      const result = await executor.query(`update app.platform_api_keys
        set api_key=null,api_key_ciphertext=$2,updated_at=now()
        where id=$1 and api_key_ciphertext=$3`, [row.id, rotated, row.api_key_ciphertext]);
      if (result.rowCount) row.api_key_ciphertext = rotated;
    }
    return decrypted.apiKey;
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
      if (row.api_key_ciphertext) await reencryptPlatformApiKeyIfNeeded(row);
      result.push(platformApiKeyView(row));
    }
    return result;
  }

  async function listPlatformApiKeysForRuntime() {
    const r = await pool.query(`select id,name,provider,base_url,api_key,api_key_ciphertext,model,max_concurrency,is_active,created_at,updated_at from app.platform_api_keys order by updated_at desc`);
    const result = [];
    for (const row of r.rows) {
      if (!row.api_key_ciphertext && row.api_key) {
        const ciphertext = encryptApiKey(row.api_key);
        await pool.query(`update app.platform_api_keys set api_key=null,api_key_ciphertext=$2,updated_at=now() where id=$1`, [row.id, ciphertext]);
        row.api_key_ciphertext = ciphertext;
        row.api_key = null;
      }
      if (row.api_key_ciphertext) await reencryptPlatformApiKeyIfNeeded(row);
      result.push(platformApiKeyRuntimeView(row));
    }
    return result;
  }

  async function createPlatformApiKey(body = {}) {
    const name = String(body.name || '').trim();
    const baseUrl = String(body.base_url || '').trim();
    const apiKey = String(body.api_key || '').trim();
    if (!name || !baseUrl || !apiKey) throw new Error('名称、API 地址、API Key 为必填项');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const r = await client.query(`insert into app.platform_api_keys(name,provider,base_url,api_key,api_key_ciphertext,model,max_concurrency,is_active) values($1,$2,$3,null,$4,$5,$6,$7) returning *`, [name, String(body.provider || 'openai'), baseUrl, encryptApiKey(apiKey), String(body.model || ''), body.max_concurrency ? Number(body.max_concurrency) : null, body.is_active === undefined ? true : Boolean(Number(body.is_active))]);
      await syncPlatformChannelModels(r.rows[0], client);
      await client.query('commit');
      return platformApiKeyView(r.rows[0]);
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async function updatePlatformApiKey(id, body = {}) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const current = await client.query(`select * from app.platform_api_keys where id=$1 for update`, [id]);
      if (!current.rowCount) throw new Error('密钥不存在');
      const old = current.rows[0];
      const oldApiKey = old.api_key_ciphertext ? decryptApiKey(old.api_key_ciphertext).apiKey : String(old.api_key || '');
      const nextApiKey = body.api_key ? String(body.api_key) : oldApiKey;
      const r = await client.query(`update app.platform_api_keys set name=$2,provider=$3,base_url=$4,api_key=null,api_key_ciphertext=$5,model=$6,max_concurrency=$7,is_active=$8,updated_at=now() where id=$1 returning *`, [id, body.name === undefined ? old.name : String(body.name), body.provider === undefined ? old.provider : String(body.provider), body.base_url === undefined ? old.base_url : String(body.base_url), encryptApiKey(nextApiKey), body.model === undefined ? old.model : String(body.model), body.max_concurrency === undefined ? old.max_concurrency : (body.max_concurrency ? Number(body.max_concurrency) : null), body.is_active === undefined ? old.is_active : Boolean(Number(body.is_active))]);
      await syncPlatformChannelModels(r.rows[0], client);
      await client.query('commit');
      return platformApiKeyView(r.rows[0]);
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async function deletePlatformApiKey(id) {
    const r = await pool.query(`delete from app.platform_api_keys where id=$1 returning id`, [id]);
    if (!r.rowCount) throw new Error('密钥不存在');
    return { success: true };
  }

  async function fetchPlatformApiKeyModels(id) {
    const r = await pool.query(`select id,base_url,api_key,api_key_ciphertext from app.platform_api_keys where id=$1 and is_active=true`, [id]);
    if (!r.rowCount) throw new Error('渠道不存在或未启用');
    const row = r.rows[0];
    const apiKey = row.api_key_ciphertext ? await reencryptPlatformApiKeyIfNeeded({ id, ...row }) : String(row.api_key || '');
    return { base_url: row.base_url, api_key: apiKey };
  }

  async function listPlatformApiKeyStats() {
    const [keysResult, usageResult] = await Promise.all([
      pool.query('select id,max_concurrency from app.platform_api_keys'),
      pool.query(`select metadata->>'channelId' channel_id,
        count(*) filter(where result='committed')::int success,
        count(*) filter(where result in ('failed','unknown'))::int failure,
        count(*) filter(where result='reserved')::int in_flight
        from app.usage_records where metadata ? 'channelId' group by metadata->>'channelId'`),
    ]);
    const result = {};
    for (const row of keysResult.rows) {
      const usage = usageResult.rows.find(item => String(item.channel_id) === String(row.id));
      result[row.id] = { success: usage?.success || 0, failure: usage?.failure || 0, inFlight: usage?.in_flight || 0, maxConcurrency: row.max_concurrency === null ? null : Number(row.max_concurrency) };
    }
    return result;
  }

  async function listPlatformApiKeyHistory() {
    const result = {};
    const keysResult = await pool.query('select id from app.platform_api_keys');
    for (const key of keysResult.rows) {
      const item = { d1: {}, d7: {}, d30: {} };
      for (const [windowKey, days] of [['d1', 1], ['d7', 7], ['d30', 30]]) {
        const rows = await pool.query(`select case when coalesce(metadata->>'targetPath','') like '%video%' then '视频' when coalesce(metadata->>'targetPath','') like '%image%' then '图片' else '文本' end capability,
          count(*)::int calls, count(*) filter(where result='committed')::int success,
          count(*) filter(where result='failed')::int failure, count(*) filter(where result='reserved')::int in_flight,
          count(*) filter(where result='released')::int released, count(*) filter(where result='unknown')::int unknown,
          round(avg(latency_ms))::int avg_latency_ms
          from app.usage_records where metadata->>'channelId'=$1 and ${windowKey === 'd1'
            ? `occurred_at >= (date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai')
              and occurred_at < ((date_trunc('day', now() at time zone 'Asia/Shanghai') + interval '1 day') at time zone 'Asia/Shanghai')`
            : 'occurred_at >= now() - make_interval(days=>$2)'} group by 1`, windowKey === 'd1' ? [String(key.id)] : [String(key.id), days]);
        const all = { calls: 0, successes: 0, failures: 0, inFlight: 0, released: 0, unknown: 0, successRate: null, failRate: null, connRate: null, avgConnRate: null, avgLatencyMs: null };
        for (const row of rows.rows) {
          const calls = Number(row.calls); const success = Number(row.success); const failure = Number(row.failure);
          const avgLatencyMs = row.avg_latency_ms === null ? null : Number(row.avg_latency_ms);
          const summary = { calls, successes: success, failures: failure, inFlight: Number(row.in_flight), released: Number(row.released), unknown: Number(row.unknown), successRate: calls ? Math.round(success * 100 / calls) : null, failRate: calls ? Math.round(failure * 100 / calls) : null, connRate: calls ? Math.round((success + failure + Number(row.released) + Number(row.unknown)) * 100 / calls) : null, avgConnRate: null, avgLatencyMs };
          item[windowKey][row.capability] = summary; all.calls += calls;
          all.successes += success; all.failures += failure; all.inFlight += Number(row.in_flight); all.released += Number(row.released); all.unknown += Number(row.unknown);
          if (avgLatencyMs !== null) all._latencyTotal = (all._latencyTotal || 0) + avgLatencyMs * calls;
        }
        all.successRate = all.calls ? Math.round(all.successes * 100 / all.calls) : null;
        all.failRate = all.calls ? Math.round(all.failures * 100 / all.calls) : null;
        all.connRate = all.calls ? Math.round((all.successes + all.failures + all.released + all.unknown) * 100 / all.calls) : null;
        all.avgLatencyMs = all._latencyTotal ? Math.round(all._latencyTotal / all.calls) : null;
        delete all._latencyTotal;
        item[windowKey]._all = all;
      }
      result[key.id] = item;
    }
    return result;
  }

  async function listPlatformApiKeyUsage(channelId, { range = 'today', capability = '全部', limit = 50, offset = 0 } = {}) {
    if (!/^[0-9a-f-]{36}$/i.test(String(channelId))) throw new Error('渠道编号无效');
    if (!['today', 'd7', 'd30'].includes(range)) throw new Error('调用时间范围无效');
    if (!['全部', '图片', '文本', '视频'].includes(capability)) throw new Error('调用类型无效');
    const pageSize = Math.min(100, Math.max(1, Number(limit) || 50));
    const pageOffset = Math.max(0, Number(offset) || 0);
    const hasDayCount = range !== 'today';
    const timeFilter = range === 'today'
      ? `u.occurred_at >= (date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai')
         and u.occurred_at < ((date_trunc('day', now() at time zone 'Asia/Shanghai') + interval '1 day') at time zone 'Asia/Shanghai')`
      : `u.occurred_at >= now() - make_interval(days=>$2)`;
    const days = range === 'd7' ? 7 : 30;
    const capabilityParameter = hasDayCount ? 3 : 2;
    const capabilityFilter = capability === '全部' ? '' : `and (case when coalesce(u.metadata->>'targetPath','') like '%video%' then '视频' when coalesce(u.metadata->>'targetPath','') like '%image%' then '图片' else '文本' end)=$${capabilityParameter}`;
    const params = range === 'today' ? [String(channelId)] : [String(channelId), days];
    if (capability !== '全部') params.push(capability);
    const filterSql = `u.metadata->>'channelId'=$1 and ${timeFilter} ${capabilityFilter}`;
    const count = await pool.query(`select count(*)::int total from app.usage_records u where ${filterSql}`, params);
    const limitParameter = params.length + 1;
    const offsetParameter = params.length + 2;
    const page = await pool.query(`select u.id,u.request_id,u.occurred_at,u.completed_at,u.provider,u.model,u.quantity,u.result,u.latency_ms,
        u.metadata->>'targetPath' target_path,u.metadata->>'statusCode' status_code,u.metadata->>'phase' phase,
        a.email user_email
      from app.usage_records u left join app.user_accounts a on a.id=u.user_id
      where ${filterSql} order by u.occurred_at desc,u.id desc limit $${limitParameter} offset $${offsetParameter}`,
      [...params, pageSize, pageOffset]);
    return {
      total: Number(count.rows[0]?.total || 0), limit: pageSize, offset: pageOffset, range,
      items: page.rows.map(row => ({ id: row.id, requestId: row.request_id || null, occurredAt: new Date(row.occurred_at).toISOString(), completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
        userEmail: row.user_email || '用户已删除', provider: row.provider || '', model: row.model || '', quantity: Number(row.quantity), status: row.result,
        latencyMs: row.latency_ms === null ? null : Number(row.latency_ms), targetPath: row.target_path || '', statusCode: row.status_code ? Number(row.status_code) : null, phase: row.phase || '' })),
    };
  }

  function capabilityForModelName(modelName) {
    const name = String(modelName || '').toLowerCase();
    if (/(video|sora|veo|kling|wan|hailuo|seedance)/.test(name)) return 'video';
    if (/(audio|speech|tts|voice|music)/.test(name)) return 'audio';
    if (/(image|dall.?e|flux|sdxl|imagen|seedream|banana)/.test(name)) return 'image';
    return 'text';
  }

  async function syncPlatformChannelModels(channel, executor = pool) {
    const models = [...new Set(String(channel.model || '').split(',').map(value => value.trim()).filter(Boolean))];
    await executor.query(`delete from app.model_catalog_channel_models
      where platform_api_key_id=$1 and not (upstream_model_id=any($2::text[]))`, [channel.id, models]);
    for (const upstreamModelId of models) {
      const catalog = await executor.query('select id from app.model_catalog where model_id=$1 limit 1', [upstreamModelId]);
      if (!catalog.rowCount) continue; // 目录里没有就跳过，不自动创建；模型目录完全由管理员手动维护
      const existingFormats = await executor.query(`select distinct case when lower(p.provider)='gemini' then 'gemini' else 'openai' end api_format
        from app.model_catalog_channel_models link join app.platform_api_keys p on p.id=link.platform_api_key_id
        where link.model_catalog_id=$1 and link.is_active=true`, [catalog.rows[0].id]);
      const desiredFormat = String(channel.provider || '').toLowerCase() === 'gemini' ? 'gemini' : 'openai';
      if (existingFormats.rows.some(row => row.api_format !== desiredFormat)) {
        const alreadyLinked = await executor.query(`select 1 from app.model_catalog_channel_models
          where model_catalog_id=$1 and platform_api_key_id=$2 and upstream_model_id=$3`, [catalog.rows[0].id, channel.id, upstreamModelId]);
        if (alreadyLinked.rowCount) throw new Error('修改渠道请求协议会与已关联模型冲突，请先移除冲突关联');
        continue;
      }
      await executor.query(`insert into app.model_catalog_channel_models(model_catalog_id,platform_api_key_id,upstream_model_id)
        values($1,$2,$3) on conflict(model_catalog_id,platform_api_key_id,upstream_model_id) do update set is_active=true`,
      [catalog.rows[0].id, channel.id, upstreamModelId]);
    }
  }

  function modelCatalogView(row) {
    return {
      id: Number(row.id),
      modelId: row.model_id,
      displayName: row.display_name,
      provider: row.provider,
      capability: row.capability,
      visible: row.visible === true,
      sortOrder: Number(row.sort_order),
      creditPrice: row.credit_price == null ? null : Number(row.credit_price),
      creditPriceUnit: row.credit_price_unit || null,
      creditPriceVersion: Number(row.credit_price_version || 1),
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  }

  async function listModelCatalog() {
    const r = await pool.query(`select mc.id,mc.model_id,mc.display_name,mc.provider,mc.capability,mc.visible,mc.sort_order,mc.credit_price,mc.credit_price_unit,mc.credit_price_version,mc.created_at,mc.updated_at,
        coalesce(jsonb_agg(jsonb_build_object('id',link.id,'channelId',pak.id,'channelName',pak.name,'provider',pak.provider,'model',link.upstream_model_id,'priority',link.priority,'isActive',link.is_active))
          filter(where link.id is not null),'[]'::jsonb) linked_models
      from app.model_catalog mc
      left join app.model_catalog_channel_models link on link.model_catalog_id=mc.id
      left join app.platform_api_keys pak on pak.id=link.platform_api_key_id
      group by mc.id order by mc.sort_order asc,mc.id asc`);
    return r.rows.map(row => ({ ...modelCatalogView(row), linkedModels: row.linked_models || [] }));
  }

  async function createModelCatalog(body = {}) {
    const displayName = String(body.displayName || '').trim().slice(0, 240);
    if (!displayName) throw new Error('请输入模型显示名称');
    const r = await pool.query(`insert into app.model_catalog(model_id,display_name,provider,capability,visible,sort_order)
      values(null,$1,'unknown',$2,$3,coalesce((select max(sort_order)+1 from app.model_catalog),0)) returning *`,
      [displayName, String(body.capability || 'text').slice(0, 32), body.visible !== false]);
    return modelCatalogView(r.rows[0]);
  }

  async function addModelCatalogChannelModel(modelCatalogId, input = {}) {
    const catalogId = Number(modelCatalogId);
    const channelId = String(input.channelId || '').trim();
    const upstreamModelId = String(input.upstreamModelId || '').trim().slice(0, 240);
    const priority = Math.max(0, Math.min(100000, Number(input.priority) || 0));
    if (!Number.isSafeInteger(catalogId) || catalogId <= 0) throw new Error('模型目录编号无效');
    if (!/^[0-9a-f-]{36}$/i.test(channelId)) throw new Error('渠道编号无效');
    if (!upstreamModelId) throw new Error('请选择渠道模型');
    const channel = await pool.query(`select p.id,p.provider from app.platform_api_keys p
      where p.id=$1 and exists(select 1 from regexp_split_to_table(coalesce(p.model,''),',') m where btrim(m)= $2)`, [channelId, upstreamModelId]);
    if (!channel.rowCount) throw new Error('所选模型不在该渠道的已配置模型列表中');
    const catalog = await pool.query('select id from app.model_catalog where id=$1', [catalogId]);
    if (!catalog.rowCount) throw new Error('模型目录不存在');
    const linkedFormats = await pool.query(`select distinct case when lower(p.provider)='gemini' then 'gemini' else 'openai' end api_format
      from app.model_catalog_channel_models l join app.platform_api_keys p on p.id=l.platform_api_key_id
      where l.model_catalog_id=$1 and l.is_active=true`, [catalogId]);
    const selectedFormat = String(channel.rows[0].provider).toLowerCase() === 'gemini' ? 'gemini' : 'openai';
    if (linkedFormats.rows.some(row => row.api_format !== selectedFormat)) throw new Error('同一目录模型只能关联相同请求协议的渠道');
    const result = await pool.query(`insert into app.model_catalog_channel_models(model_catalog_id,platform_api_key_id,upstream_model_id,priority,is_active)
      values($1,$2,$3,$4,true) on conflict(model_catalog_id,platform_api_key_id,upstream_model_id)
      do update set priority=excluded.priority,is_active=true returning id`, [catalogId, channelId, upstreamModelId, priority]);
    return { id: result.rows[0].id, catalogModelId: catalogId, channelId, upstreamModelId, priority, isActive: true };
  }

  async function removeModelCatalogChannelModel(modelCatalogId, bindingId) {
    const result = await pool.query('delete from app.model_catalog_channel_models where model_catalog_id=$1 and id=$2 returning id', [modelCatalogId, bindingId]);
    if (!result.rowCount) throw new Error('模型渠道关联不存在');
    return { success: true };
  }

  async function listPublicModelCatalogChannels() {
    const result = await pool.query(`select mc.id,mc.display_name,mc.capability,mc.sort_order,
        min(p.provider) filter(where l.is_active and p.is_active) provider,
        min(l.priority) filter(where l.is_active and p.is_active) priority
      from app.model_catalog mc
      join app.model_catalog_channel_models l on l.model_catalog_id=mc.id and l.is_active=true
      join app.platform_api_keys p on p.id=l.platform_api_key_id and p.is_active=true
      where mc.visible=true group by mc.id order by mc.sort_order,mc.id`);
    const models = result.rows.map(row => ({ name: `catalog:${row.id}`, displayName: row.display_name, capability: row.capability }));
    if (!models.length) return [];
    return models.map(model => {
      const catalogId = Number(model.name.slice('catalog:'.length));
      const row = result.rows.find(item => Number(item.id) === catalogId);
      const provider = String(row?.provider || 'openai');
      return {
        id: `catalog-${catalogId}`, name: row?.display_name || model.displayName,
        provider: provider.toLowerCase() === 'gemini' ? 'gemini' : 'openai',
        base_url: provider.toLowerCase() === 'gemini' ? 'https://generativelanguage.googleapis.com' : 'https://api.openai.com',
        model: model.name, models: [model],
      };
    });
  }

  async function listPlatformModelRoutes(modelCatalogId) {
    const catalogId = Number(modelCatalogId);
    if (!Number.isSafeInteger(catalogId) || catalogId <= 0) return [];
    const result = await pool.query(`select p.id,p.name,p.provider,p.base_url,p.api_key,p.api_key_ciphertext,p.model,p.max_concurrency,p.is_active,p.created_at,p.updated_at,l.upstream_model_id
      from app.model_catalog_channel_models l join app.platform_api_keys p on p.id=l.platform_api_key_id
      join app.model_catalog mc on mc.id=l.model_catalog_id
      where l.model_catalog_id=$1 and l.is_active=true and p.is_active=true and mc.visible=true
      order by l.priority,l.id`, [catalogId]);
    const routes = [];
    for (const row of result.rows) {
      await reencryptPlatformApiKeyIfNeeded(row);
      routes.push({ channel: platformApiKeyRuntimeView(row), model: row.upstream_model_id });
    }
    return routes;
  }

  async function bulkCreateModelCatalog(models = []) {
    const client = await pool.connect();
    let added = 0;
    try {
      await client.query('begin');
      for (const body of Array.isArray(models) ? models.slice(0, 1000) : []) {
        const modelId = String(body?.modelId || '').trim().slice(0, 160);
        if (!modelId) continue;
        const r = await client.query(`insert into app.model_catalog(model_id,display_name,provider,capability,visible,sort_order)
          values($1,$2,$3,$4,$5,coalesce((select max(sort_order)+1 from app.model_catalog),0)) on conflict(model_id) do nothing`,
          [modelId, String(body.displayName || modelId).trim().slice(0, 240) || modelId, String(body.provider || 'unknown').slice(0, 80), String(body.capability || 'text').slice(0, 32), body.visible !== false]);
        added += r.rowCount;
      }
      await client.query('commit');
      return { added, total: Number((await pool.query('select count(*)::int as count from app.model_catalog')).rows[0].count) };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function updateModelCatalog(id, body = {}) {
    const current = await pool.query('select * from app.model_catalog where id=$1', [id]);
    if (!current.rowCount) throw new Error('模型不存在');
    const old = current.rows[0];
    const priceChanged = body.creditPrice !== undefined || body.creditPriceUnit !== undefined;
    const creditPrice = body.creditPrice === undefined ? old.credit_price : body.creditPrice === null || body.creditPrice === '' ? null : Number(body.creditPrice);
    const creditPriceUnit = body.creditPriceUnit === undefined ? old.credit_price_unit : body.creditPriceUnit || null;
    if (creditPrice != null && (!Number.isFinite(creditPrice) || creditPrice <= 0)) throw new Error('积分价格必须大于0');
    if (creditPrice != null && !['request','output','second','thousand_chars'].includes(creditPriceUnit)) throw new Error('积分计价单位无效');
    if ((creditPrice == null) !== (creditPriceUnit == null)) throw new Error('积分价格和计价单位必须同时填写或同时清空');
    const client = await pool.connect();
    let r;
    try {
      await client.query('begin');
      const updated = await client.query(`update app.model_catalog set display_name=$2,capability=$3,visible=$4,sort_order=$5,
        credit_price=$6,credit_price_unit=$7,credit_price_version=credit_price_version+$8,updated_at=now() where id=$1 returning *`,
        [id, body.displayName === undefined ? old.display_name : String(body.displayName).trim().slice(0, 240), body.capability === undefined ? old.capability : String(body.capability).slice(0, 32), body.visible === undefined ? old.visible : Boolean(body.visible), body.sortOrder === undefined ? old.sort_order : Math.max(0, Number(body.sortOrder) || 0), creditPrice, creditPriceUnit, priceChanged ? 1 : 0]);
      r = updated;
      if (priceChanged) await client.query(`insert into app.model_credit_price_history(model_catalog_id,price_version,credit_price,credit_price_unit,changed_by)
        values($1,$2,$3,$4,current_setting('app.admin_actor',true))`, [id, updated.rows[0].credit_price_version, creditPrice, creditPriceUnit]);
      await client.query('commit');
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
    return modelCatalogView(r.rows[0]);
  }

  async function createModelCreditQuote(appwriteUserId, input = {}) {
    const modelId = Number(String(input.model || '').match(/catalog:(\d+)/)?.[1]);
    if (!Number.isSafeInteger(modelId) || modelId <= 0) throw new Error('此生成模型不属于平台积分计费目录');
    const me = await getUser(appwriteUserId);
    if (!me) throw new Error('用户不存在，请重新登录');
    const model = await pool.query(`select id,capability,credit_price,credit_price_unit,credit_price_version from app.model_catalog where id=$1 and visible=true`, [modelId]);
    if (!model.rowCount) throw new Error('模型不可用');
    const row = model.rows[0];
    if (row.credit_price == null || !row.credit_price_unit) throw new Error('该模型尚未设置用户积分价格，请联系管理员');
    const taskType = String(input.taskType || row.capability).slice(0, 32);
    if (!['image','video','audio','text'].includes(taskType)) throw new Error('生成类型无效');
    if (row.capability !== taskType) throw new Error('所选模型能力与生成类型不匹配');
    const parameters = input.parameters && typeof input.parameters === 'object' ? { ...input.parameters } : {};
    delete parameters.model;
    delete parameters.__qingyuCatalogModelId;
    delete parameters.n;
    const prompt = String(input.prompt || '').slice(0, 4000);
    const quantity = Math.max(1, Math.min(15, Number(input.quantity) || 1));
    let units = row.credit_price_unit === 'output' ? quantity : row.credit_price_unit === 'second' ? Math.max(1, Number(parameters.duration) || 1) : row.credit_price_unit === 'thousand_chars' ? Math.max(0.001, prompt.length / 1000) : 1;
    const totalCredits = Math.max(0.000001, Number((Number(row.credit_price) * units).toFixed(6)));
    const snapshot = { taskType, prompt, parameters, quantity };
    const hash = crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    const quote = await pool.query(`insert into app.model_credit_quotes(workspace_id,user_id,model_catalog_id,task_type,price_version,price_unit,unit_count,credit_price,total_credits,request_hash,request_snapshot,expires_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,now()+interval '5 minutes') returning id,price_version,price_unit,unit_count,credit_price,total_credits,expires_at`,
      [me.workspace_id, me.internal_user_id, modelId, taskType, row.credit_price_version, row.credit_price_unit, units, row.credit_price, totalCredits, hash, JSON.stringify(snapshot)]);
    return { id: quote.rows[0].id, modelCatalogId: modelId, taskType, priceVersion: Number(quote.rows[0].price_version), priceUnit: quote.rows[0].price_unit, unitCount: Number(quote.rows[0].unit_count), creditPrice: Number(quote.rows[0].credit_price), totalCredits: Number(quote.rows[0].total_credits), balance: Number(me.balance), expiresAt: new Date(quote.rows[0].expires_at).toISOString() };
  }

  async function deleteModelCatalog(id) {
    const r = await pool.query('delete from app.model_catalog where id=$1 returning id', [id]);
    if (!r.rowCount) throw new Error('模型不存在');
    return { success: true };
  }

  async function saveCanvasSnapshot(appwriteUserId, snapshot = {}) {
    const projects = Array.isArray(snapshot.projects) ? snapshot.projects.slice(0, 100) : [];
    const savedVersions = [];
    for (const project of projects) {
      for (const node of Array.isArray(project.nodes) ? project.nodes : []) {
        const metadata = node?.metadata && typeof node.metadata === 'object' ? node.metadata : {};
        if (node?.type === 'text' && typeof metadata.content === 'string' && metadata.content.length) {
          throw new Error('文本内容必须先保存到 COS，画布快照只接受文件编号');
        }
        if (['image','video','audio'].includes(node?.type) && typeof metadata.content === 'string' && metadata.content.length) {
          throw new Error('媒体文件必须先保存到 COS，画布快照只接受文件编号');
        }
        if (Array.isArray(metadata.texts) && metadata.texts.some(text => typeof text?.content === 'string' && text.content.length)) {
          throw new Error('多段文本必须先保存到 COS，画布快照只接受文件编号');
        }
        if (Array.isArray(metadata.images) && metadata.images.some(image => typeof image?.content === 'string' && image.content.length)) {
          throw new Error('画布图片必须先保存到 COS，画布快照只接受文件编号');
        }
        if (Array.isArray(metadata.uploadedImages) && metadata.uploadedImages.some(image => typeof image === 'string' && !/^(image|video|audio):/.test(image))) {
          throw new Error('画布参考图必须先保存到 COS，画布快照只接受文件编号');
        }
        if (Array.isArray(metadata.references) && metadata.references.some(reference => typeof reference === 'string' && /^(?:data:|blob:|https?:\/\/)/i.test(reference))) {
          throw new Error('生成参考素材必须先保存到 COS，画布快照只接受文件编号');
        }
      }
      for (const session of Array.isArray(project.chatSessions) ? project.chatSessions : []) {
        for (const message of Array.isArray(session.messages) ? session.messages : []) {
          if (typeof message?.text === 'string' && message.text.length) throw new Error('画布对话文本必须先保存到 COS');
          if (Array.isArray(message?.references) && message.references.some(reference => reference?.dataUrl || reference?.text)) {
            throw new Error('画布对话参考素材必须先保存到 COS');
          }
        }
      }
    }
    const client = await pool.connect();
    try {
      await client.query('begin');
      const userId = await setWorkspaceUserContext(client, appwriteUserId);
      const owner = await client.query(`select u.id user_id,w.id workspace_id from app.user_accounts u join app.workspaces w on w.owner_user_id=u.id and w.type='personal' and w.status='active' where u.id=$1 and u.status='active'`, [userId]);
      if (!owner.rowCount) throw new Error('用户不存在，请重新登录');
      const { workspace_id: workspaceId } = owner.rows[0];
      for (const raw of projects) {
        const externalKey = String(raw.id || '').trim().slice(0, 160);
        if (!externalKey) continue;
        const expectedVersion = Number.isSafeInteger(raw.serverVersion) && raw.serverVersion > 0 ? raw.serverVersion : null;
        const projectValues = [workspaceId, userId, externalKey, String(raw.title || '未命名画布').slice(0, 240), String(raw.backgroundMode || 'lines').slice(0, 32), Boolean(raw.showImageInfo), JSON.stringify(raw.viewport || { x: 0, y: 0, k: 1 })];
        let project;
        if (expectedVersion === null) {
          project = await client.query(`insert into app.canvas_projects(workspace_id,created_by,external_key,title,background_mode,show_image_info,viewport,status,updated_at)
            values($1,$2,$3,$4,$5,$6,$7::jsonb,'active',now())
            on conflict(workspace_id,external_key) do nothing
            returning id,version`, projectValues);
          if (!project.rowCount) {
            const current = await client.query(`select version from app.canvas_projects where workspace_id=$1 and external_key=$2`, [workspaceId, externalKey]);
            const error = new Error('这张画布已在云端存在或已被其他设备修改，本机草稿已保留');
            error.code = 'VERSION_CONFLICT';
            error.conflicts = [{ projectId: externalKey, serverVersion: current.rowCount ? Number(current.rows[0].version) : null }];
            throw error;
          }
        } else {
          project = await client.query(`update app.canvas_projects set title=$3,background_mode=$4,show_image_info=$5,viewport=$6::jsonb,
              status='active',deleted_at=null,version=version+1,updated_at=now()
            where workspace_id=$1 and external_key=$2 and version=$7 and status='active'
            returning id,version`, [workspaceId, externalKey, projectValues[3], projectValues[4], projectValues[5], projectValues[6], expectedVersion]);
          if (!project.rowCount) {
            const current = await client.query(`select version,status from app.canvas_projects where workspace_id=$1 and external_key=$2`, [workspaceId, externalKey]);
            const error = new Error('这张画布已在云端被其他设备修改，本机草稿已保留');
            error.code = 'VERSION_CONFLICT';
            error.conflicts = [{ projectId: externalKey, serverVersion: current.rowCount && current.rows[0].status === 'active' ? Number(current.rows[0].version) : null }];
            throw error;
          }
        }
        const projectId = project.rows[0].id;
        savedVersions.push({ id: externalKey, serverVersion: Number(project.rows[0].version) });
        const assetIds = [...collectCanvasAssetIds(raw.nodes)];
        const linkedAssets = assetIds.length ? await client.query(`select a.id asset_id,av.id asset_version_id
          from app.assets a
          join lateral (select id from app.asset_versions where asset_id=a.id and workspace_id=a.workspace_id order by version_no desc limit 1) av on true
          join app.asset_files af on af.asset_version_id=av.id and af.workspace_id=a.workspace_id and af.role='source'
          join app.file_objects f on f.id=af.file_id and f.workspace_id=a.workspace_id and f.status='ready'
          where a.id=any($1::uuid[]) and a.workspace_id=$2 and (a.status='active' or exists(
            select 1 from app.canvas_project_assets existing
            where existing.project_id=$3 and existing.workspace_id=$2 and existing.asset_id=a.id
          ))`, [assetIds, workspaceId, projectId]) : { rows: [] };
        if (linkedAssets.rows.length !== assetIds.length) throw new Error('画布包含不存在、未就绪或不属于当前工作空间的素材');
        await client.query(`delete from app.canvas_project_assets where project_id=$1 and workspace_id=$2
          and not (asset_id=any($3::uuid[]))`, [projectId, workspaceId, assetIds]);
        for (const asset of linkedAssets.rows) {
          // 已关联素材保留首次固定的版本；新素材固定到当前最新版本。
          await client.query(`insert into app.canvas_project_assets(workspace_id,project_id,asset_id,asset_version_id,added_by)
            values($1,$2,$3,$4,$5) on conflict(project_id,asset_id) do nothing`, [workspaceId, projectId, asset.asset_id, asset.asset_version_id, userId]);
        }
        const fixedAssets = assetIds.length ? await client.query(`select cpa.asset_id,cpa.asset_version_id,af.file_id
          from app.canvas_project_assets cpa
          join app.asset_files af on af.asset_version_id=cpa.asset_version_id and af.workspace_id=cpa.workspace_id and af.role='source'
          join app.file_objects f on f.id=af.file_id and f.workspace_id=af.workspace_id and f.status='ready'
          where cpa.project_id=$1 and cpa.workspace_id=$2 and cpa.asset_id=any($3::uuid[])`, [projectId, workspaceId, assetIds]) : { rows: [] };
        if (fixedAssets.rows.length !== assetIds.length) throw new Error('画布素材当前固定版本的原文件不可用');
        const fixedAssetById = new Map(fixedAssets.rows.map(asset => [String(asset.asset_id), asset]));
        await client.query(`delete from app.canvas_connections where project_id=$1 and workspace_id=$2`, [projectId, workspaceId]);
        await client.query(`delete from app.canvas_chat_sessions where project_id=$1 and workspace_id=$2`, [projectId, workspaceId]);
        await client.query(`delete from app.canvas_nodes where project_id=$1 and workspace_id=$2`, [projectId, workspaceId]);
        const nodeIds = new Map();
        for (const node of Array.isArray(raw.nodes) ? raw.nodes.slice(0, 2000) : []) {
          const nodeKey = String(node.id || '').trim().slice(0, 160);
          if (!nodeKey) continue;
          const inserted = await client.query(`insert into app.canvas_nodes(project_id,workspace_id,node_key,node_type,title,position,width,height,metadata) values($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb) returning id`, [projectId, workspaceId, nodeKey, String(node.type || 'text').slice(0, 120), String(node.title || '').slice(0, 240), JSON.stringify(node.position || { x: 0, y: 0 }), Math.max(1, Number(node.width) || 1), Math.max(1, Number(node.height) || 1), JSON.stringify(node.metadata || {})]);
          nodeIds.set(nodeKey, inserted.rows[0].id);
          for (const use of collectCanvasAssetUses(node.metadata || {})) {
            const asset = fixedAssetById.get(use.assetId);
            if (!asset) throw new Error('画布节点引用了未登记的素材');
            await client.query(`insert into app.canvas_node_asset_uses(workspace_id,project_id,node_id,slot_key,asset_id,asset_version_id,file_id,file_role,created_by)
              values($1,$2,$3,$4,$5,$6,$7,'source',$8)`, [workspaceId, projectId, inserted.rows[0].id, use.slotKey, asset.asset_id, asset.asset_version_id, asset.file_id, userId]);
          }
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
            await client.query(`insert into app.canvas_chat_messages(session_id,workspace_id,message_key,role,content,detail) values($1,$2,$3,$4,$5,$6::jsonb)`, [inserted.rows[0].id, workspaceId, messageKey, allowedRole, String(message.text || '').slice(0, 200000), JSON.stringify({ title: message.title || null, meta: message.meta || null, detail: message.detail || null, references: message.references || [], textStorageKey: message.textStorageKey || null, textChecksum: message.textChecksum || null })]);
          }
        }
        await client.query(`insert into app.outbox_events(event_type,aggregate_type,aggregate_id,workspace_id,payload) values('canvas.project.saved','canvas_project',$1,$2,$3::jsonb)`, [projectId, workspaceId, JSON.stringify({ externalKey, nodeCount: nodeIds.size, serverVersion: Number(project.rows[0].version) })]);
      }
      await client.query('commit');
      return { saved: savedVersions.length, versions: savedVersions };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function listCanvasSnapshots(appwriteUserId) {
    const owner = await pool.query(`select u.id user_id,w.id workspace_id from app.user_accounts u join app.workspaces w on w.owner_user_id=u.id and w.type='personal' and w.status='active' where u.appwrite_user_id=$1 and u.status='active'`, [appwriteUserId]);
    if (!owner.rowCount) throw new Error('用户不存在，请重新登录');
    const workspaceId = owner.rows[0].workspace_id;
    const projects = await pool.query(`select id,external_key,title,background_mode,show_image_info,viewport,version,created_at,updated_at from app.canvas_projects where workspace_id=$1 and status='active' order by updated_at desc limit 100`, [workspaceId]);
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
        chatSessions.push({ id: session.session_key, title: session.title, createdAt: new Date(session.created_at).toISOString(), updatedAt: new Date(session.updated_at).toISOString(), messages: messages.rows.map(x => ({ id: x.message_key, role: x.role, text: x.content, title: x.detail?.title || undefined, meta: x.detail?.meta || undefined, detail: x.detail?.detail || undefined, references: x.detail?.references || [], textStorageKey: x.detail?.textStorageKey || undefined, textChecksum: x.detail?.textChecksum || undefined })) });
      }
      result.push({ id: project.external_key, serverVersion: Number(project.version), title: project.title, createdAt: new Date(project.created_at).toISOString(), updatedAt: new Date(project.updated_at).toISOString(), nodes: nodes.rows.map(x => ({ id: x.node_key, type: x.node_type, title: x.title, position: x.position, width: Number(x.width), height: Number(x.height), metadata: x.metadata || {} })), connections: connections.rows.map(x => ({ id: x.connection_key, fromNodeId: idToKey.get(x.from_node_id), toNodeId: idToKey.get(x.to_node_id) })).filter(x => x.fromNodeId && x.toNodeId), chatSessions, activeChatId: null, backgroundMode: project.background_mode, showImageInfo: project.show_image_info, viewport: project.viewport });
    }
    return { projects: result, deletedProjects: [] };
  }

  async function saveAgentSnapshot(appwriteUserId, snapshot = {}) {
    const externalThreadId = String(snapshot.threadId || '').trim().slice(0, 200);
    if (!externalThreadId) return { saved: false };
    const client = await pool.connect();
    try {
      await client.query('begin');
      const owner = await client.query(`select u.id user_id,w.id workspace_id from app.user_accounts u join app.workspaces w on w.owner_user_id=u.id and w.type='personal' and w.status='active' where u.appwrite_user_id=$1 and u.status='active'`, [appwriteUserId]);
      if (!owner.rowCount) throw new Error('用户不存在，请重新登录');
      const { user_id: userId, workspace_id: workspaceId } = owner.rows[0];
      const thread = await client.query(`insert into app.agent_threads(workspace_id,user_id,external_thread_id,title,workspace_path,status,updated_at) values($1,$2,$3,$4,$5,'active',now()) on conflict(workspace_id,external_thread_id) do update set title=coalesce(excluded.title,app.agent_threads.title),workspace_path=coalesce(excluded.workspace_path,app.agent_threads.workspace_path),status='active',updated_at=now() returning id`, [workspaceId, userId, externalThreadId, snapshot.title ? String(snapshot.title).slice(0, 240) : null, snapshot.workspacePath ? String(snapshot.workspacePath) : null]);
      const threadId = thread.rows[0].id;
      for (const item of Array.isArray(snapshot.messages) ? snapshot.messages.slice(-1000) : []) {
        const itemId = String(item.itemId || item.id || '').trim().slice(0, 200);
        if (!itemId) continue;
        const role = ['user', 'assistant', 'system', 'tool', 'error'].includes(item.role) ? item.role : 'assistant';
        const usage = item.storageKey ? { ...(item.usage && typeof item.usage === 'object' ? item.usage : {}), textStorageKey: String(item.storageKey).slice(0, 500), textChecksum: String(item.textChecksum || '').slice(0, 128) } : item.usage || null;
        await client.query(`insert into app.agent_messages(thread_id,workspace_id,external_item_id,role,content,attachments,canvas_references,usage) values($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) on conflict(thread_id,external_item_id) do update set role=excluded.role,content=excluded.content,attachments=excluded.attachments,canvas_references=excluded.canvas_references,usage=excluded.usage`, [threadId, workspaceId, itemId, role, item.storageKey ? '' : String(item.text || '').slice(0, 200000), JSON.stringify((item.attachments || []).map(({ dataUrl, ...safe }) => safe)), JSON.stringify(item.canvasReferences || []), JSON.stringify(usage)]);
      }
      for (const event of Array.isArray(snapshot.events) ? snapshot.events.slice(-1000) : []) {
        const eventId = String(event.id || '').trim().slice(0, 200);
        if (!eventId) continue;
        const payload = event.storageKey
          ? { storageKey: String(event.storageKey).slice(0, 500), checksum: String(event.textChecksum || '').slice(0, 128) }
          : { text: String(event.text || '').slice(0, 200000), raw: event.raw || null };
        await client.query(`insert into app.agent_event_logs(thread_id,workspace_id,external_event_id,event_type,payload) values($1,$2,$3,$4,$5::jsonb) on conflict(thread_id,external_event_id) where external_event_id is not null do update set event_type=excluded.event_type,payload=excluded.payload`, [threadId, workspaceId, eventId, String(event.title || 'agent.event').slice(0, 120), JSON.stringify(payload)]);
      }
      await client.query('commit');
      return { saved: true, threadId };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  // ===== AI 对话：对话与消息 CRUD =====
  async function getChatWorkspace(appwriteUserId) {
    const r = await pool.query(`select u.id user_id, w.id workspace_id
      from app.user_accounts u
      join app.workspaces w on w.owner_user_id=u.id and w.type='personal' and w.status='active'
      where u.appwrite_user_id=$1 and u.status='active'`, [appwriteUserId]);
    if (!r.rowCount) throw new Error('用户不存在，请重新登录');
    return r.rows[0];
  }

  async function listChatConversations(appwriteUserId) {
    const { workspace_id: workspaceId } = await getChatWorkspace(appwriteUserId);
    const r = await pool.query(`select id,title,model,summary,created_at,updated_at
      from app.chat_conversations
      where workspace_id=$1
      order by updated_at desc
      limit 200`, [workspaceId]);
    return r.rows.map(x => ({
      id: x.id, title: x.title, model: x.model, summary: x.summary,
      createdAt: new Date(x.created_at).toISOString(),
      updatedAt: new Date(x.updated_at).toISOString(),
    }));
  }

  async function createChatConversation(appwriteUserId, data = {}) {
    const { user_id: userId, workspace_id: workspaceId } = await getChatWorkspace(appwriteUserId);
    const r = await pool.query(`insert into app.chat_conversations(workspace_id,user_id,title,model,system_prompt,temperature,web_search_enabled)
      values($1,$2,$3,$4,$5,$6,$7) returning id,title,created_at,updated_at`,
      [workspaceId, userId,
        String(data.title || '新对话').slice(0, 240),
        data.model ? String(data.model).slice(0, 160) : null,
        data.systemPrompt ? String(data.systemPrompt).slice(0, 8000) : null,
        Math.max(0, Math.min(2, Number(data.temperature) || 0.7)),
        Boolean(data.webSearchEnabled)]);
    const row = r.rows[0];
    return { id: row.id, title: row.title, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
  }

  async function getChatConversation(appwriteUserId, conversationId) {
    const { workspace_id: workspaceId } = await getChatWorkspace(appwriteUserId);
    const r = await pool.query(`select id,title,model,system_prompt,temperature,web_search_enabled,summary,share_id,created_at,updated_at
      from app.chat_conversations where id=$1 and workspace_id=$2`, [conversationId, workspaceId]);
    if (!r.rowCount) return null;
    const x = r.rows[0];
    return {
      id: x.id, title: x.title, model: x.model, systemPrompt: x.system_prompt,
      temperature: Number(x.temperature), webSearchEnabled: x.web_search_enabled,
      summary: x.summary, shareId: x.share_id,
      createdAt: new Date(x.created_at).toISOString(), updatedAt: new Date(x.updated_at).toISOString(),
    };
  }

  async function listChatMessages(appwriteUserId, conversationId) {
    const { workspace_id: workspaceId } = await getChatWorkspace(appwriteUserId);
    const conv = await pool.query(`select id from app.chat_conversations where id=$1 and workspace_id=$2`, [conversationId, workspaceId]);
    if (!conv.rowCount) return null;
    const r = await pool.query(`select id,role,content,tokens_in,tokens_out,status,created_at
      from app.chat_messages where conversation_id=$1 order by created_at`, [conversationId]);
    return r.rows.map(x => ({
      id: x.id, role: x.role, content: x.content,
      tokensIn: Number(x.tokens_in), tokensOut: Number(x.tokens_out),
      status: x.status, createdAt: new Date(x.created_at).toISOString(),
    }));
  }

  async function appendChatMessage(appwriteUserId, conversationId, data) {
    const { workspace_id: workspaceId } = await getChatWorkspace(appwriteUserId);
    const conv = await pool.query(`select id from app.chat_conversations where id=$1 and workspace_id=$2`, [conversationId, workspaceId]);
    if (!conv.rowCount) throw new Error('对话不存在或无权访问');
    const role = ['user','assistant','system'].includes(data.role) ? data.role : 'user';
    const r = await pool.query(`insert into app.chat_messages(conversation_id,workspace_id,role,content,tokens_in,tokens_out,status)
      values($1,$2,$3,$4,$5,$6,$7) returning id,created_at`,
      [conversationId, workspaceId, role,
        String(data.content || '').slice(0, 200000),
        Number(data.tokensIn) || 0, Number(data.tokensOut) || 0,
        ['completed','aborted','failed'].includes(data.status) ? data.status : 'completed']);
    await pool.query(`update app.chat_conversations set updated_at=now() where id=$1`, [conversationId]);
    return { id: r.rows[0].id, createdAt: new Date(r.rows[0].created_at).toISOString() };
  }

  async function updateChatConversation(appwriteUserId, conversationId, data) {
    const { workspace_id: workspaceId } = await getChatWorkspace(appwriteUserId);
    const sets = [];
    const params = [];
    let i = 1;
    if (data.title !== undefined) { sets.push(`title=$${i++}`); params.push(String(data.title).slice(0, 240)); }
    if (data.model !== undefined) { sets.push(`model=$${i++}`); params.push(data.model ? String(data.model).slice(0, 160) : null); }
    if (data.systemPrompt !== undefined) { sets.push(`system_prompt=$${i++}`); params.push(data.systemPrompt ? String(data.systemPrompt).slice(0, 8000) : null); }
    if (data.temperature !== undefined) { sets.push(`temperature=$${i++}`); params.push(Math.max(0, Math.min(2, Number(data.temperature) || 0.7))); }
    if (data.webSearchEnabled !== undefined) { sets.push(`web_search_enabled=$${i++}`); params.push(Boolean(data.webSearchEnabled)); }
    if (data.summary !== undefined) { sets.push(`summary=$${i++}`); params.push(data.summary ? String(data.summary).slice(0, 8000) : null); }
    if (!sets.length) return { updated: false };
    params.push(conversationId, workspaceId);
    const r = await pool.query(`update app.chat_conversations set ${sets.join(',')} where id=$${i++} and workspace_id=$${i++} returning id,title`, params);
    if (!r.rowCount) throw new Error('对话不存在或无权访问');
    return { updated: true, id: r.rows[0].id, title: r.rows[0].title };
  }

  async function deleteChatConversation(appwriteUserId, conversationId) {
    const { workspace_id: workspaceId } = await getChatWorkspace(appwriteUserId);
    const r = await pool.query(`delete from app.chat_conversations where id=$1 and workspace_id=$2 returning id`, [conversationId, workspaceId]);
    if (!r.rowCount) throw new Error('对话不存在或无权访问');
    return { deleted: true };
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
    const r = await pool.query(`select u.appwrite_user_id,u.email,u.display_name,tm.status,tm.joined_at,d.name department_name,j.name job_title_name,
      case when t.owner_user_id=tm.user_id then 'owner' else coalesce(rb.role_code,'member') end role
      from app.team_memberships tm join app.teams t on t.id=tm.team_id join app.user_accounts u on u.id=tm.user_id
      left join app.departments d on d.id=tm.department_id and d.team_id=tm.team_id and d.status='active'
      left join app.job_titles j on j.id=tm.job_title_id and j.team_id=tm.team_id and j.status='active'
      left join app.workspaces w on w.team_id=t.id and w.type='team'
      left join lateral (select r.code role_code from app.role_bindings b join app.roles r on r.id=b.role_id where b.workspace_id=w.id and b.user_id=tm.user_id limit 1) rb on true
      where tm.team_id=$1 and tm.status in ('active','invited') and exists (select 1 from app.team_memberships me join app.user_accounts mu on mu.id=me.user_id where me.team_id=t.id and me.user_id=(select id from app.user_accounts where appwrite_user_id=$2) and me.status='active')
      order by tm.joined_at nulls last,tm.created_at`, [teamId, appwriteUserId]);
    return r.rows.map(x => ({ id: x.appwrite_user_id, email: x.email || '', name: x.display_name || x.email || '', status: x.status, role: x.role, departmentName: x.department_name || null, jobTitleName: x.job_title_name || null, joinedAt: x.joined_at ? new Date(x.joined_at).toISOString() : null }));
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
      if (departmentId) {
        const department = await client.query(`select 1 from app.departments where id=$1 and team_id=$2 and status='active'`, [departmentId, teamId]);
        if (!department.rowCount) throw new Error('部门不存在或不属于当前团队');
      }
      if (jobTitleId) {
        const jobTitle = await client.query(`select 1 from app.job_titles where id=$1 and team_id=$2 and status='active'`, [jobTitleId, teamId]);
        if (!jobTitle.rowCount) throw new Error('岗位不存在或不属于当前团队');
      }
      const finalStatus = nextStatus || target.rows[0].current_status;
      await client.query(`update app.team_memberships set status=$1::app.membership_status,left_at=case when $1='left' then now() else null end,
        department_id=case when $3 then $4::uuid else department_id end,
        job_title_id=case when $5 then $6::uuid else job_title_id end,
        updated_at=now() where id=$2`, [finalStatus, target.rows[0].membership_id, departmentId !== undefined, departmentId, jobTitleId !== undefined, jobTitleId]);
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

  async function listAssets(appwriteUserId, type = 'all', keyword = '', status = 'active') {
    const assetStatus = status === 'deleted' ? 'deleted' : 'active';
    const client = await pool.connect();
    try {
    await client.query('begin');
    await setWorkspaceUserContext(client, appwriteUserId);
    const r = await client.query(`select a.id,a.title,a.asset_type,a.visibility,a.status,a.deleted_at,a.created_at,a.updated_at,
      coalesce((select count(*) from app.asset_likes l where l.asset_id=a.id and l.workspace_id=a.workspace_id),0) like_count,
      coalesce((select count(*) from app.asset_comments c where c.asset_id=a.id and c.workspace_id=a.workspace_id and c.deleted_at is null and c.moderation_status='approved'),0) comment_count,
      exists(select 1 from app.asset_likes my_like where my_like.asset_id=a.id and my_like.workspace_id=a.workspace_id and my_like.user_id=(select id from app.user_accounts where appwrite_user_id=$1)) is_liked,
      coalesce((select v.metadata from app.asset_versions v where v.asset_id=a.id order by v.version_no desc limit 1),'{}'::jsonb) metadata,
      exists(select 1 from app.collections c join app.collection_items ci on ci.collection_id=c.id where c.workspace_id=a.workspace_id and c.created_by=(select id from app.user_accounts where appwrite_user_id=$1) and c.name='favorites' and ci.asset_id=a.id) is_favorite
      from app.assets a where a.status=$4 and ($2='all' or a.asset_type=$2) and ($3='' or a.title ilike '%'||$3||'%') and exists(select 1 from app.workspaces w where w.id=a.workspace_id and (w.owner_user_id=(select id from app.user_accounts where appwrite_user_id=$1) or exists(select 1 from app.team_memberships tm where tm.team_id=w.team_id and tm.user_id=(select id from app.user_accounts where appwrite_user_id=$1) and tm.status='active'))) order by a.updated_at desc limit 200`, [appwriteUserId, type, keyword, assetStatus]);
    await client.query('commit');
    return r.rows.map(x => ({ id: x.id, name: x.title, type: x.asset_type, visibility: x.visibility, status: x.status, deletedAt: x.deleted_at ? new Date(x.deleted_at).toISOString() : null, likeCount: Number(x.like_count), commentCount: Number(x.comment_count), liked: Boolean(x.is_liked), favorited: x.is_favorite, metadata: x.metadata || {}, createdAt: new Date(x.created_at).toISOString(), updatedAt: new Date(x.updated_at).toISOString() }));
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function listFavorites(appwriteUserId) { return listAssets(appwriteUserId, 'all', '').then(items => items.filter(x => x.favorited)); }

  async function changeAssetDeletedStatus(appwriteUserId, assetId, restore) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const userId = await setWorkspaceUserContext(client, appwriteUserId);
      const access = await client.query(`select a.id,a.workspace_id,a.status,a.title
        from app.assets a join app.workspaces w on w.id=a.workspace_id
        where a.id=$1 and a.status in ('active','deleted') and
          (a.created_by=$2 or w.owner_user_id=$2 or exists(
            select 1 from app.team_memberships tm
            join app.role_bindings b on b.user_id=tm.user_id
            join app.roles r on r.id=b.role_id
            join app.workspaces rw on rw.id=b.workspace_id
            where tm.team_id=w.team_id and tm.user_id=$2 and tm.status='active'
              and rw.id=a.workspace_id and r.code in ('owner','admin')
          )) for update of a`, [assetId, userId]);
      if (!access.rowCount) {
        const error = new Error('素材不存在或你没有管理权限');
        error.status = 404;
        throw error;
      }
      const asset = access.rows[0];
      const nextStatus = restore ? 'active' : 'deleted';
      if (asset.status !== nextStatus) {
        await client.query(`update app.assets set status=$2,deleted_at=$3,updated_at=now(),version=version+1
          where id=$1`, [assetId, nextStatus, restore ? null : new Date()]);
        await client.query(`insert into app.outbox_events(event_type,aggregate_type,aggregate_id,workspace_id,payload)
          values($1,'asset',$2,$3,$4::jsonb)`, [restore ? 'asset.restored' : 'asset.deleted', assetId, asset.workspace_id, JSON.stringify({ title: asset.title })]);
      }
      await client.query('commit');
      return { id: assetId, status: nextStatus };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function deleteAsset(appwriteUserId, assetId) {
    return changeAssetDeletedStatus(appwriteUserId, assetId, false);
  }

  async function restoreAsset(appwriteUserId, assetId) {
    return changeAssetDeletedStatus(appwriteUserId, assetId, true);
  }

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

  async function toggleAssetLike(appwriteUserId, assetId, liked) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const user = await client.query(`select id from app.user_accounts where appwrite_user_id=$1 and status='active'`, [appwriteUserId]);
      if (!user.rowCount) throw new Error('用户不存在，请重新登录');
      const access = await client.query(`select a.id,a.workspace_id from app.assets a
        where a.id=$1 and a.status='active' and exists(
          select 1 from app.workspaces w where w.id=a.workspace_id and
          (w.owner_user_id=$2 or exists(select 1 from app.team_memberships tm where tm.team_id=w.team_id and tm.user_id=$2 and tm.status='active'))
        )`, [assetId, user.rows[0].id]);
      if (!access.rowCount) throw new Error('资产不存在或无权访问');
      if (liked) await client.query(`insert into app.asset_likes(asset_id,user_id,workspace_id) values($1,$2,$3) on conflict (asset_id,user_id) do nothing`, [assetId, user.rows[0].id, access.rows[0].workspace_id]);
      else await client.query(`delete from app.asset_likes where asset_id=$1 and user_id=$2 and workspace_id=$3`, [assetId, user.rows[0].id, access.rows[0].workspace_id]);
      const count = await client.query(`select count(*)::int like_count from app.asset_likes where asset_id=$1 and workspace_id=$2`, [assetId, access.rows[0].workspace_id]);
      await client.query('commit');
      return { assetId, liked: Boolean(liked), likeCount: Number(count.rows[0].like_count) };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function processRecoverablePaymentEvents(limit = 20) {
    const exhausted = await pool.query(`update app.payment_events set status='failed',next_retry_at=null,
        error_message=coalesce(error_message,'支付通知处理进程中断，且已达到自动重试上限')
      where status='processing' and attempt_count>=8 and (last_attempt_at is null or last_attempt_at<now()-interval '2 minutes')
      returning id,provider,provider_event_id,order_id,attempt_count,error_message`);
    for (const event of exhausted.rows) {
      await pool.query(`select app.record_payment_alert('payment_event_retry_exhausted','critical',w.id,'支付通知处理多次中断，已停止自动重试',jsonb_build_object('event_id',$1,'provider',$2,'provider_event_id',$3,'attempt_count',$4,'error',$5))
        from app.orders o left join app.workspaces w on w.id=o.workspace_id where o.id=$6`,
      [event.id, event.provider, event.provider_event_id, event.attempt_count, event.error_message, event.order_id]);
    }
    const claimed = await pool.query(`with due as (
        select id from app.payment_events
        where signature_verified=true and attempt_count<8 and (
          (status in ('received','failed') and next_retry_at<=now()) or
          (status='processing' and (last_attempt_at is null or last_attempt_at<now()-interval '2 minutes'))
        )
        order by coalesce(next_retry_at,last_attempt_at),received_at limit $1 for update skip locked
      )
      update app.payment_events pe set status='processing',attempt_count=attempt_count+1,last_attempt_at=now(),next_retry_at=null
      from due where pe.id=due.id returning pe.provider,pe.provider_event_id`, [Math.min(100, Math.max(1, Number(limit) || 20))]);
    let processed = 0;
    for (const event of claimed.rows) {
      try { await processPaymentEvent(event.provider, event.provider_event_id); processed++; }
      catch (error) { await schedulePaymentEventRetry(event.provider, event.provider_event_id, error); }
    }
    return { claimed: claimed.rowCount, processed };
  }

  async function listAssetComments(appwriteUserId, assetId) {
    const r = await pool.query(`select c.id,c.parent_id,c.content,c.moderation_status,c.created_at,c.edited_at,
        coalesce(u.email,'已删除用户') author_email
      from app.asset_comments c
      join app.assets a on a.id=c.asset_id and a.workspace_id=c.workspace_id
      left join app.user_accounts u on u.id=c.author_user_id
      where c.asset_id=$1 and c.deleted_at is null and c.moderation_status='approved'
        and exists(select 1 from app.user_accounts viewer join app.workspaces w on w.id=a.workspace_id
          where viewer.appwrite_user_id=$2 and viewer.status='active' and
          (w.owner_user_id=viewer.id or exists(select 1 from app.team_memberships tm where tm.team_id=w.team_id and tm.user_id=viewer.id and tm.status='active')))
      order by c.created_at asc`, [assetId, appwriteUserId]);
    return r.rows.map(x => ({ id: x.id, parentId: x.parent_id, content: x.content, status: x.moderation_status, authorEmail: x.author_email, createdAt: new Date(x.created_at).toISOString(), editedAt: x.edited_at ? new Date(x.edited_at).toISOString() : null }));
  }

  async function createAssetComment(appwriteUserId, assetId, content, parentId = null) {
    const clean = String(content || '').trim();
    if (!clean || clean.length > 10000) throw new Error('评论不能为空且不能超过10000个字符');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const user = await client.query(`select id from app.user_accounts where appwrite_user_id=$1 and status='active'`, [appwriteUserId]);
      if (!user.rowCount) throw new Error('用户不存在，请重新登录');
      const access = await client.query(`select a.id,a.workspace_id from app.assets a
        where a.id=$1 and a.status='active' and exists(select 1 from app.workspaces w where w.id=a.workspace_id and
          (w.owner_user_id=$2 or exists(select 1 from app.team_memberships tm where tm.team_id=w.team_id and tm.user_id=$2 and tm.status='active')))`, [assetId, user.rows[0].id]);
      if (!access.rowCount) throw new Error('资产不存在或无权访问');
      if (parentId) {
        const parent = await client.query(`select 1 from app.asset_comments where id=$1 and asset_id=$2 and workspace_id=$3 and deleted_at is null`, [parentId, assetId, access.rows[0].workspace_id]);
        if (!parent.rowCount) throw new Error('回复目标不存在或不属于当前资产');
      }
      const inserted = await client.query(`insert into app.asset_comments(asset_id,workspace_id,parent_id,author_user_id,content,moderation_status)
        values($1,$2,$3,$4,$5,'approved') returning id,parent_id,content,moderation_status,created_at`, [assetId, access.rows[0].workspace_id, parentId || null, user.rows[0].id, clean]);
      await client.query('commit');
      const x = inserted.rows[0];
      return { id: x.id, parentId: x.parent_id, content: x.content, status: x.moderation_status, createdAt: new Date(x.created_at).toISOString() };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function ensureAssetUploadBatch(client, uploadBatchId, workspaceId, userId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(uploadBatchId || ''))) {
      throw new Error('上传批次编号无效');
    }
    await client.query(`insert into app.upload_batches(id,workspace_id,created_by,idempotency_key)
      values($1,$2,$3,$4) on conflict(id) do nothing`, [uploadBatchId, workspaceId, userId, `upload:${uploadBatchId}`]);
    const batch = await client.query(`select workspace_id,created_by from app.upload_batches where id=$1 for update`, [uploadBatchId]);
    if (!batch.rowCount || String(batch.rows[0].workspace_id).toLowerCase() !== String(workspaceId).toLowerCase() || String(batch.rows[0].created_by).toLowerCase() !== String(userId).toLowerCase()) {
      throw new Error('上传批次不存在或不属于当前用户及工作空间');
    }
  }

  async function getAssetUploadScope(appwriteUserId) {
    const me = await getUser(appwriteUserId);
    if (!me) throw new Error('用户不存在，请重新登录');
    return { workspaceId: me.workspace_id };
  }

  async function createContentEdit(appwriteUserId, input = {}) {
    const idempotencyKey = String(input.idempotencyKey || '').trim().slice(0, 160);
    const assetIds = Array.isArray(input.referenceAssetIds) ? input.referenceAssetIds.map(value => String(value).toLowerCase()) : [];
    if (!idempotencyKey) throw new Error('编辑编号不能为空');
    if (!assetIds.length || assetIds.length > 100 || assetIds.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))) {
      throw new Error('参考素材无效或数量超出限制');
    }
    const client = await pool.connect();
    try {
      await client.query('begin');
      const userId = await setWorkspaceUserContext(client, appwriteUserId);
      const owner = await client.query(`select u.id user_id,w.id workspace_id from app.user_accounts u
        join app.workspaces w on w.owner_user_id=u.id and w.type='personal' and w.status='active'
        where u.id=$1 and u.status='active'`, [userId]);
      if (!owner.rowCount) throw new Error('用户不存在，请重新登录');
      const { user_id: internalUserId, workspace_id: workspaceId } = owner.rows[0];
      const references = await client.query(`select a.id asset_id,af.file_id
        from app.assets a
        join lateral (select id from app.asset_versions where asset_id=a.id and workspace_id=a.workspace_id order by version_no desc limit 1) av on true
        join app.asset_files af on af.asset_version_id=av.id and af.workspace_id=a.workspace_id and af.role='source'
        join app.file_objects f on f.id=af.file_id and f.workspace_id=a.workspace_id and f.status='ready'
        where a.id=any($1::uuid[]) and a.workspace_id=$2 and a.status='active'`, [assetIds, workspaceId]);
      const fileByAssetId = new Map(references.rows.map(row => [String(row.asset_id), String(row.file_id)]));
      if (fileByAssetId.size !== new Set(assetIds).size) throw new Error('参考素材不存在、未就绪或不属于当前工作空间');
      const inserted = await client.query(`insert into app.content_edits(workspace_id,created_by,idempotency_key)
        values($1,$2,$3) on conflict(workspace_id,idempotency_key) do nothing returning id`, [workspaceId, internalUserId, idempotencyKey]);
      let editId = inserted.rows[0]?.id;
      if (!editId) {
        const existing = await client.query(`select id,created_by from app.content_edits where workspace_id=$1 and idempotency_key=$2 for update`, [workspaceId, idempotencyKey]);
        if (!existing.rowCount || String(existing.rows[0].created_by) !== String(internalUserId)) throw new Error('编辑编号已属于其他用户');
        editId = existing.rows[0].id;
      } else {
        for (const [position, assetId] of assetIds.entries()) {
          await client.query(`insert into app.content_edit_inputs(workspace_id,edit_id,file_id,role,position)
            values($1,$2,$3,$4,$5)`, [workspaceId, editId, fileByAssetId.get(assetId), position === 0 ? 'base' : 'reference', position]);
        }
      }
      const current = await client.query(`select file_id,role,position from app.content_edit_inputs where workspace_id=$1 and edit_id=$2 order by position`, [workspaceId, editId]);
      const requested = assetIds.map(id => fileByAssetId.get(id));
      if (current.rows.length !== requested.length || current.rows.some((row, index) => String(row.file_id) !== requested[index] || Number(row.position) !== index || row.role !== (index === 0 ? 'base' : 'reference'))) {
        throw new Error('同一编辑编号不能更换参考素材');
      }
      await client.query('commit');
      return { editId, baseFileId: requested[0] };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function createAssetUploadSession(appwriteUserId, input) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const userId = await setWorkspaceUserContext(client, appwriteUserId);
      const owner = await client.query(`select u.id user_id,w.id workspace_id from app.user_accounts u
        join app.workspaces w on w.owner_user_id=u.id and w.type='personal' and w.status='active'
        where u.id=$1 for update of u,w`, [userId]);
      if (!owner.rowCount) throw new Error('用户不存在，请重新登录');
      const { workspace_id: workspaceId } = owner.rows[0];
      const sessionId = crypto.randomUUID();
      const idempotencyKey = String(input.idempotencyKey || '').trim();
      if (idempotencyKey && idempotencyKey.length > 160) throw new Error('文件保存编号不能超过160个字符');
      const fileId = String(input.fileId || crypto.randomUUID());
      if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw new Error('文件编号无效');
      const title = String(input.title || '').trim();
      const mimeType = String(input.mimeType || 'application/octet-stream').slice(0, 160);
      const sizeBytes = Number(input.sizeBytes);
      const sourceKind = ['generated','reference_upload','manual_upload','edited','derived'].includes(input.sourceKind) ? input.sourceKind : 'manual_upload';
      const mediaType = ['image','video','audio','text','document','other'].includes(input.mediaType) ? input.mediaType : 'other';
      if (!title || title.length > 240 || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 5 * 1024 * 1024 * 1024) throw new Error('上传文件名称或大小无效');
      const editId = sourceKind === 'edited' ? String(input.editId || '') : null;
      const sourceFileId = ['edited','derived'].includes(sourceKind) ? String(input.sourceFileId || '').toLowerCase() : null;
      const previewVariant = sourceKind === 'derived' ? String(input.previewVariant || '') : null;
      if (sourceKind === 'edited') {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(editId) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceFileId)) throw new Error('编辑来源记录无效');
        const source = await client.query(`select 1 from app.content_edits ce join app.content_edit_inputs cei on cei.edit_id=ce.id and cei.workspace_id=ce.workspace_id
          join app.file_objects f on f.id=cei.file_id and f.workspace_id=cei.workspace_id and f.status='ready'
          where ce.id=$1 and ce.workspace_id=$2 and ce.created_by=$3 and cei.file_id=$4 and cei.role='base'`, [editId, workspaceId, userId, sourceFileId]);
        if (!source.rowCount) throw new Error('编辑记录或原始素材不存在、未就绪或不属于当前用户');
      }
      if (sourceKind === 'derived') {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceFileId)
          || !isAssetPreviewVariant(previewVariant) || mediaType !== 'image') throw new Error('预览文件必须是图片，并提供有效的原文件编号和预览规格');
        const source = await client.query(`select 1 from app.file_objects where id=$1 and workspace_id=$2 and status='ready'
          and ($3 <> 'video-cover' or media_type='video')`, [sourceFileId, workspaceId, previewVariant]);
        if (!source.rowCount) throw new Error('预览原文件不存在、未就绪或类型不匹配');
      }
      const uploadBatchId = ['generated','edited','derived'].includes(sourceKind) ? null : String(input.uploadBatchId || crypto.randomUUID());
      if (uploadBatchId) {
        await ensureAssetUploadBatch(client, uploadBatchId, workspaceId, userId);
      }
      const objectKey = String(input.objectKey || '');
      if (!objectKey.startsWith(`workspaces/${workspaceId}/`) || objectKey.includes('..')) throw new Error('上传对象键与当前工作空间不匹配');
      await client.query(`insert into app.file_objects(
        id,workspace_id,uploaded_by,storage_provider,bucket,object_key,size_bytes,mime_type,status,media_type,source_kind,
        original_filename,upload_batch_id,width,height,duration_ms,completeness,inspection_status,edit_id,source_file_id,write_idempotency_key,preview_variant
      ) values($1,$2,$3,'cos',$4,$5,$6,$7,'pending',$8,$9,$10,$11,$12,$13,$14,$15,'pending',$16,$17,$18,$19)`, [
        fileId, workspaceId, userId, input.bucket, objectKey, sizeBytes, mimeType, mediaType, sourceKind, title, uploadBatchId,
        Number.isInteger(input.width) && input.width > 0 ? input.width : null,
        Number.isInteger(input.height) && input.height > 0 ? input.height : null,
        Number.isInteger(input.durationMs) && input.durationMs >= 0 ? input.durationMs : null,
        mediaType === 'text' ? (input.completeness === 'complete' ? 'complete' : 'partial') : null,
        editId, sourceFileId, idempotencyKey || null, previewVariant,
      ]);
      await client.query(`insert into app.upload_sessions(id,workspace_id,file_id,attempt_no,provider_upload_id,status,expires_at)
        values($1,$2,$3,1,$4,'initiated',now()+interval '24 hours')`, [sessionId, workspaceId, fileId, input.providerUploadId]);
      await client.query(`update app.upload_sessions set status='uploading' where id=$1`, [sessionId]);
      await client.query('commit');
      return { sessionId, fileId, uploadBatchId, objectKey, sizeBytes };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function getAssetUploadSession(appwriteUserId, sessionId) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const userId = await setWorkspaceUserContext(client, appwriteUserId);
      const r = await client.query(`select s.id,s.status,s.provider_upload_id,s.expires_at,f.id file_id,f.workspace_id,
          f.object_key,f.bucket,f.size_bytes,f.mime_type,f.media_type,f.source_kind,f.original_filename,
          f.width,f.height,f.duration_ms,f.completeness,f.write_idempotency_key,f.edit_id,f.source_file_id,f.preview_variant,
          a.id asset_id,a.asset_type,a.title asset_title
        from app.upload_sessions s join app.file_objects f on f.id=s.file_id and f.workspace_id=s.workspace_id
        join app.workspaces w on w.id=s.workspace_id
        left join app.asset_files af on af.file_id=f.id and af.workspace_id=f.workspace_id and af.role='source'
        left join app.asset_versions av on av.id=af.asset_version_id and av.workspace_id=f.workspace_id
        left join app.assets a on a.id=av.asset_id and a.workspace_id=f.workspace_id
        where s.id=$1 and w.type='personal' and w.owner_user_id=$2`, [sessionId, userId]);
      if (!r.rowCount) throw new Error('上传会话不存在或无权访问');
      const x = r.rows[0];
      const parts = await client.query(`select part_number,etag,size_bytes,checksum from app.upload_session_parts where session_id=$1 order by part_number`, [sessionId]);
      await client.query('commit');
      return { id: x.id, status: x.status, providerUploadId: x.provider_upload_id, expiresAt: x.expires_at,
        fileId: x.file_id, workspaceId: x.workspace_id, objectKey: x.object_key, bucket: x.bucket,
        sizeBytes: Number(x.size_bytes), mimeType: x.mime_type, mediaType: x.media_type, sourceKind: x.source_kind,
        originalFilename: x.original_filename, width: x.width, height: x.height, durationMs: x.duration_ms,
        completeness: x.completeness, writeIdempotencyKey: x.write_idempotency_key,
        editId: x.edit_id, sourceFileId: x.source_file_id, previewVariant: x.preview_variant,
        assetId: x.asset_id || null, assetType: x.asset_type || null,
        assetTitle: x.asset_title || null, parts: parts.rows.map(p => ({ partNumber: p.part_number, etag: p.etag, sizeBytes: Number(p.size_bytes), checksum: p.checksum })) };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function recordAssetUploadPart(appwriteUserId, sessionId, part) {
    const session = await getAssetUploadSession(appwriteUserId, sessionId);
    if (session.status !== 'uploading') throw new Error('上传会话当前不可接收分片');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await setWorkspaceUserContext(client, appwriteUserId);
      await client.query(`insert into app.upload_session_parts(session_id,workspace_id,part_number,etag,size_bytes,checksum)
        values($1,$2,$3,$4,$5,$6) on conflict(session_id,part_number) do update set etag=excluded.etag,size_bytes=excluded.size_bytes,checksum=excluded.checksum`,
      [session.id, session.workspaceId, part.partNumber, part.etag, part.sizeBytes, part.checksum || null]);
      await client.query('commit');
      return { recorded: true };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function beginAssetUploadCompletion(appwriteUserId, sessionId, cosParts) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const userId = await setWorkspaceUserContext(client, appwriteUserId);
      const session = await client.query(`select s.id,s.workspace_id,s.file_id,s.status,f.size_bytes
        from app.upload_sessions s join app.file_objects f on f.id=s.file_id and f.workspace_id=s.workspace_id
        join app.workspaces w on w.id=s.workspace_id join app.user_accounts u on u.id=w.owner_user_id
        where s.id=$1 and u.id=$2 and u.status='active' and w.type='personal' for update of s,f`, [sessionId, userId]);
      if (!session.rowCount || !['uploading','completing'].includes(session.rows[0].status)) throw new Error('上传会话不存在或当前不可完成');
      const recorded = await client.query(`select part_number,etag,size_bytes from app.upload_session_parts where session_id=$1 order by part_number`, [sessionId]);
      const expected = recorded.rows.map(row => ({ partNumber: Number(row.part_number), etag: row.etag, sizeBytes: Number(row.size_bytes) }));
      const actual = Array.isArray(cosParts) ? cosParts : [];
      if (!expected.length || actual.length !== expected.length) throw new Error('COS 分片数量与上传记录不一致');
      let totalBytes = 0;
      for (let index = 0; index < expected.length; index += 1) {
        const left = expected[index];
        const right = actual[index];
        if (left.partNumber !== index + 1 || right?.partNumber !== left.partNumber || right.etag !== left.etag || right.sizeBytes !== left.sizeBytes) throw new Error('COS 分片校验未通过');
        totalBytes += left.sizeBytes;
      }
      if (totalBytes !== Number(session.rows[0].size_bytes)) throw new Error('分片总大小与原文件不一致');
      if (session.rows[0].status === 'uploading') await client.query(`update app.upload_sessions set status='completing' where id=$1`, [sessionId]);
      await client.query(`insert into app.file_jobs(workspace_id,file_id,job_kind,idempotency_key,upload_session_id,next_run_at)
        values($1,$2,'persist',$3,$4,now()+interval '2 minutes')
        on conflict(workspace_id,idempotency_key) do nothing`,
      [session.rows[0].workspace_id, session.rows[0].file_id, `upload-persist:${session.rows[0].id}`, session.rows[0].id]);
      await client.query('commit');
      return { sessionId, fileId: session.rows[0].file_id, workspaceId: session.rows[0].workspace_id, sizeBytes: totalBytes, parts: expected };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function failAssetUploadSession(appwriteUserId, sessionId, errorCode = 'upload_failed') {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const userId = await setWorkspaceUserContext(client, appwriteUserId);
      const session = await client.query(`select s.id,s.workspace_id,s.file_id,s.status from app.upload_sessions s
        join app.workspaces w on w.id=s.workspace_id join app.user_accounts u on u.id=w.owner_user_id
        where s.id=$1 and u.id=$2 and u.status='active' and w.type='personal' for update of s`, [sessionId, userId]);
      if (!session.rowCount) throw new Error('上传会话不存在或无权操作');
      const row = session.rows[0];
      if (['initiated','uploading','completing'].includes(row.status)) await client.query(`update app.upload_sessions set status='aborting' where id=$1`, [sessionId]);
      const current = await client.query(`select status from app.upload_sessions where id=$1`, [sessionId]);
      if (current.rows[0].status === 'aborting') await client.query(`update app.upload_sessions set status='aborted',last_error_code=$2 where id=$1`, [sessionId, String(errorCode).slice(0, 120)]);
      await client.query(`update app.file_objects set status='failed',last_error_code=$2,updated_at=now() where id=$1 and status='pending'`, [row.file_id, String(errorCode).slice(0, 120)]);
      await client.query('commit');
      return { aborted: true };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function enqueueAssetUploadRecovery(appwriteUserId, sessionId) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const userId = await setWorkspaceUserContext(client, appwriteUserId);
      const session = await client.query(`select s.workspace_id,s.file_id,s.id
        from app.upload_sessions s join app.workspaces w on w.id=s.workspace_id
        join app.user_accounts u on u.id=w.owner_user_id
        where s.id=$1 and u.id=$2 and u.status='active' and w.type='personal' and s.status='completing'`, [sessionId, userId]);
      if (!session.rowCount) throw new Error('只有正在完成的上传可以进入恢复队列');
      await client.query(`insert into app.file_jobs(workspace_id,file_id,job_kind,idempotency_key,upload_session_id)
        values($1,$2,'persist',$3,$4) on conflict(workspace_id,idempotency_key) do nothing`,
      [session.rows[0].workspace_id, session.rows[0].file_id, `upload-persist:${session.rows[0].id}`, session.rows[0].id]);
      await client.query('commit');
      return { queued: true };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function claimFileUploadRecoveryJobs(workerId, limit = 10) {
    const owner = String(workerId || '').trim().slice(0, 200);
    if (!owner) throw new Error('文件恢复执行器编号不能为空');
    const result = await pool.query(`select * from app.claim_file_upload_recovery_jobs($1,$2)`,
      [owner, Math.max(1, Math.min(50, Number(limit) || 10))]);
    return result.rows.map(row => ({ id: row.id, workspaceId: row.workspace_id, fileId: row.file_id,
      uploadSessionId: row.upload_session_id, generationOutputId: row.generation_output_id,
      leaseVersion: Number(row.lease_version), attemptCount: Number(row.attempt_count),
      appwriteUserId: row.appwrite_user_id, leaseOwner: owner }));
  }

  async function beginGenerationAttempt(appwriteUserId, taskId) {
    const me = await getUser(appwriteUserId);
    if (!me) throw new Error('用户不存在，请重新登录');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.user_id',$1,true)`, [me.internal_user_id]);
      const task = await client.query(`select id,workspace_id,provider,status from app.generation_tasks
        where id=$1 and workspace_id=$2 and created_by=$3 for update`, [taskId, me.workspace_id, me.internal_user_id]);
      if (!task.rowCount || task.rows[0].status !== 'running') throw new Error('任务当前不能启动生成尝试');
      const attempt = await client.query(`insert into app.generation_attempts(workspace_id,task_id,attempt_no,provider)
        select $1,$2,coalesce(max(attempt_no),0)+1,$3 from app.generation_attempts where task_id=$2
        returning id`, [task.rows[0].workspace_id, taskId, task.rows[0].provider || null]);
      await client.query('commit');
      return { attemptId: attempt.rows[0].id, workspaceId: task.rows[0].workspace_id };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function setGenerationAttemptProviderTask(appwriteUserId, taskId, attemptId, providerTaskId) {
    const me = await getUser(appwriteUserId);
    if (!me) throw new Error('用户不存在，请重新登录');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.user_id',$1,true)`, [me.internal_user_id]);
      const result = await client.query(`update app.generation_attempts a set provider_task_id=$4
        from app.generation_tasks t where a.id=$1 and a.task_id=$2 and a.workspace_id=t.workspace_id
          and t.id=a.task_id and t.workspace_id=$3 and t.created_by=$5 and t.status='running'
        returning a.id`, [attemptId, taskId, me.workspace_id, String(providerTaskId || '').slice(0, 200), me.internal_user_id]);
      if (!result.rowCount) throw new Error('供应商异步任务编号无法写入');
      await client.query('commit');
      return true;
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function reserveGeneratedOutput(appwriteUserId, taskId, attemptId, index, { bucket, recoveryUrl = null, revisedPrompt = null, outputType = 'image', extension = null } = {}) {
    const me = await getUser(appwriteUserId);
    if (!me) throw new Error('用户不存在，请重新登录');
    if (!bucket || !Number.isInteger(index) || index < 0 || index > 14 || !['image','video','audio'].includes(outputType)) throw new Error('生成结果槽位参数无效');
    let recoveryCiphertext = null;
    if (recoveryUrl) {
      const parsed = new URL(String(recoveryUrl));
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
        || String(recoveryUrl).length > 24000) throw new Error('上游图片地址无效，无法安全保存恢复信息');
      recoveryCiphertext = encryptApiKey(String(recoveryUrl));
    }
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.user_id',$1,true)`, [me.internal_user_id]);
      const task = await client.query(`select id,workspace_id,created_by,created_at,status,task_type from app.generation_tasks
        where id=$1 and workspace_id=$2 and created_by=$3 for update`, [taskId, me.workspace_id, me.internal_user_id]);
      if (!task.rowCount || !['running','saving'].includes(task.rows[0].status)) throw new Error('任务已结束，不能继续保存图片');
      if (task.rows[0].task_type !== outputType) throw new Error('生成结果类型与任务不匹配');
      const existing = await client.query(`select o.id output_id,o.file_id,f.object_key
        from app.generation_outputs o join app.file_objects f on f.id=o.file_id and f.workspace_id=o.workspace_id
        where o.task_id=$1 and o.workspace_id=$2 and o.attempt_id=$3 and o.output_index=$4 for update of o,f`,
      [taskId, task.rows[0].workspace_id, attemptId, index]);
      if (existing.rowCount) {
        await client.query(`update app.generation_outputs set recovery_source_ciphertext=coalesce(recovery_source_ciphertext,$2),
          metadata=metadata||$3::jsonb where id=$1 and availability='awaiting'`,
        [existing.rows[0].output_id, recoveryCiphertext, JSON.stringify(revisedPrompt ? { revisedPrompt: String(revisedPrompt).slice(0, 4000) } : {})]);
        await client.query('commit');
        return { outputId: existing.rows[0].output_id, fileId: existing.rows[0].file_id, objectKey: existing.rows[0].object_key };
      }
      const fileId = crypto.randomUUID();
      const outputId = crypto.randomUUID();
      const createdAt = new Date(task.rows[0].created_at);
      const objectKey = `workspaces/${task.rows[0].workspace_id}/generated/${outputType}s/${createdAt.getUTCFullYear()}/${String(createdAt.getUTCMonth()+1).padStart(2,'0')}/${taskId}/${fileId}`;
      const fallbackExtension = outputType === 'video' ? 'mp4' : outputType === 'audio' ? 'mp3' : 'png';
      const safeExtension = typeof extension === 'string' && /^[a-z0-9]{2,8}$/i.test(extension) ? extension.toLowerCase() : fallbackExtension;
      const file = await client.query(`insert into app.file_objects(id,workspace_id,uploaded_by,storage_provider,bucket,object_key,status,mime_type,media_type,source_kind,original_filename,inspection_status)
        values($1,$2,$3,'cos',$4,$5,'pending',null,$6,'generated',$7,'approved') returning id`,
      [fileId, task.rows[0].workspace_id, task.rows[0].created_by, bucket, objectKey, outputType, `${fileId}.${safeExtension}`]);
      const metadata = { source: `${outputType}_generation`, index, ...(revisedPrompt ? { revisedPrompt: String(revisedPrompt).slice(0, 4000) } : {}) };
      await client.query(`insert into app.generation_outputs(id,task_id,workspace_id,file_id,output_type,content_status,metadata,attempt_id,output_index,availability,recovery_source_ciphertext)
        values($1,$2,$3,$4,$5,'pending',$6::jsonb,$7,$8,'awaiting',$9)`,
      [outputId, taskId, task.rows[0].workspace_id, file.rows[0].id, outputType, JSON.stringify(metadata), attemptId, index, recoveryCiphertext]);
      await client.query(`insert into app.file_jobs(workspace_id,file_id,job_kind,idempotency_key,generation_output_id,next_run_at)
        values($1,$2,'persist',$3,$4,case when $5::text is null and $6='image' then now() else now()+interval '2 minutes' end)`,
      [task.rows[0].workspace_id, fileId, `generation-output:${outputId}`, outputId, recoveryCiphertext, outputType]);
      const complete = await client.query(`select response_complete from app.generation_attempts where id=$1 and task_id=$2 and workspace_id=$3`,
        [attemptId, taskId, task.rows[0].workspace_id]);
      if (!complete.rowCount) throw new Error('生成尝试不存在');
      if (complete.rows[0].response_complete && task.rows[0].status === 'running') {
        await client.query(`select app.mark_generation_task_saving($1)`, [taskId]);
      }
      await client.query('commit');
      return { outputId, fileId, objectKey };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function completeGenerationAttempt(appwriteUserId, taskId, attemptId, returnedOutputCount, providerTaskId = null) {
    const me = await getUser(appwriteUserId);
    if (!me) throw new Error('用户不存在，请重新登录');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.user_id',$1,true)`, [me.internal_user_id]);
      const attempt = await client.query(`update app.generation_attempts a set response_complete=true,
          returned_output_count=$4,provider_task_id=coalesce($5,a.provider_task_id),finished_at=now()
        from app.generation_tasks t where a.id=$1 and a.task_id=$2 and a.workspace_id=$3
          and t.id=a.task_id and t.workspace_id=a.workspace_id and t.created_by=$6 and t.status in ('running','saving')
        returning t.id,t.status`, [attemptId, taskId, me.workspace_id, returnedOutputCount, providerTaskId, me.internal_user_id]);
      if (!attempt.rowCount) throw new Error('生成尝试不存在或无权访问');
      const pending = await client.query(`select 1 from app.generation_outputs where attempt_id=$1 and availability='awaiting' limit 1`, [attemptId]);
      if (pending.rowCount && ['running','pending'].includes(attempt.rows[0].status)) {
        await client.query(`select app.mark_generation_task_saving($1)`, [taskId]);
      }
      await client.query('commit');
      return true;
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function getGenerationOutputRecoveryContext(job) {
    const me = await getUser(job.appwriteUserId);
    if (!me) throw new Error('用户不存在，请重新登录');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.user_id',$1,true)`, [me.internal_user_id]);
      const result = await client.query(`select j.status job_status,j.file_id,j.generation_output_id,j.lease_owner,j.lease_version,j.lease_until,
          o.task_id,o.attempt_id,o.output_index,o.output_type,o.availability,o.recovery_source_ciphertext,
          f.bucket,f.object_key,f.size_bytes,f.mime_type,f.media_type,t.status task_status,a.response_complete
        from app.file_jobs j join app.generation_outputs o on o.id=j.generation_output_id and o.file_id=j.file_id and o.workspace_id=j.workspace_id
        join app.file_objects f on f.id=j.file_id and f.workspace_id=j.workspace_id
        join app.generation_tasks t on t.id=o.task_id and t.workspace_id=o.workspace_id
        join app.generation_attempts a on a.id=o.attempt_id and a.task_id=o.task_id and a.workspace_id=o.workspace_id
        where j.id=$1 and j.workspace_id=$2 and o.id=$3 and t.created_by=$4`,
      [job.id, me.workspace_id, job.generationOutputId, me.internal_user_id]);
      if (!result.rowCount) throw new Error('图片恢复作业不存在或无权访问');
      const row = result.rows[0];
      await client.query('commit');
      return { ...row, recoveryUrl: row.recovery_source_ciphertext ? decryptApiKey(row.recovery_source_ciphertext).apiKey : null };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function recordGeneratedOutput(appwriteUserId, taskId, file) {
    const me = await getUser(appwriteUserId);
    if (!me) throw new Error('用户不存在，请重新登录');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.user_id',$1,true)`, [me.internal_user_id]);
      const result = await client.query(`select o.id output_id,o.file_id,o.task_id,o.workspace_id,o.output_index,o.output_type,o.availability,t.status task_status
        from app.generation_outputs o join app.generation_tasks t on t.id=o.task_id and t.workspace_id=o.workspace_id
        where o.id=$1 and o.task_id=$2 and o.file_id=$3 and o.workspace_id=$4 for update of o,t`,
      [file.outputId, taskId, file.fileId, me.workspace_id]);
      if (!result.rowCount) throw new Error('生成图片槽位不存在或不匹配');
      const slot = result.rows[0];
      if (slot.availability === 'available') { await client.query('commit'); return { fileId: slot.file_id, outputId: slot.output_id }; }
      if (slot.availability !== 'awaiting' || !['running','saving'].includes(slot.task_status)) throw new Error('生成任务已结束或图片槽位不可写入');
      const fileUpdated = await client.query(`update app.file_objects set storage_version_id=$2,checksum=$3,size_bytes=$4,mime_type=$5,
          width=$6,height=$7,duration_ms=$8,status='ready',inspection_status='approved',updated_at=now()
        where id=$1 and workspace_id=$9 and status in ('pending','ready')`,
      [slot.file_id, file.storageVersionId || null, file.sha256 || null, file.sizeBytes, file.contentType || 'application/octet-stream',
        file.width || null, file.height || null, file.durationMs || null, slot.workspace_id]);
      if (!fileUpdated.rowCount) throw new Error('图片数据库文件记录不存在或状态不可用');
      const outputUpdated = await client.query(`update app.generation_outputs set availability='available',content_status='approved',
          width=$2,height=$3,duration_ms=$4,recovery_source_ciphertext=null where id=$1 and availability='awaiting'`,
      [slot.output_id, file.width || null, file.height || null, file.durationMs || null]);
      if (!outputUpdated.rowCount) throw new Error('图片输出槽位状态已变化');
      await client.query(`update app.file_jobs set status='cancelled',last_error_code='output_saved_inline'
        where generation_output_id=$1 and status in ('queued','retry_wait')`, [slot.output_id]);
      await client.query('commit');
      return { fileId: slot.file_id, outputId: slot.output_id };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function finishGeneratedOutputRecoveryJob(job, file) {
    const me = await getUser(job.appwriteUserId);
    if (!me) throw new Error('用户不存在，请重新登录');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.user_id',$1,true)`, [me.internal_user_id]);
      await client.query(`select set_config('app.file_job_lease_owner',$1,true),set_config('app.file_job_lease_version',$2,true)`,
        [job.leaseOwner, String(job.leaseVersion)]);
      const result = await client.query(`select j.id,o.id output_id,o.file_id,o.availability,o.task_id,t.status task_status
        from app.file_jobs j join app.generation_outputs o on o.id=j.generation_output_id and o.file_id=j.file_id and o.workspace_id=j.workspace_id
        join app.generation_tasks t on t.id=o.task_id and t.workspace_id=o.workspace_id
        where j.id=$1 and j.generation_output_id=$2 and j.status='running' and j.lease_owner=$3 and j.lease_version=$4
          and j.lease_until>clock_timestamp() and o.availability='awaiting' and t.status='saving'
        for update of j,o,t`, [job.id, job.generationOutputId, job.leaseOwner, job.leaseVersion]);
      if (!result.rowCount) throw new Error('图片恢复任务租约失效或任务已结束');
      const row = result.rows[0];
      const fileUpdated = await client.query(`update app.file_objects set storage_version_id=$2,checksum=$3,size_bytes=$4,mime_type=$5,
          width=$6,height=$7,status='ready',inspection_status='approved',updated_at=now()
        where id=$1 and status in ('pending','ready') returning id`, [row.file_id, file.storageVersionId || null, file.sha256 || null,
        file.sizeBytes, file.contentType || 'application/octet-stream', file.width || null, file.height || null]);
      if (!fileUpdated.rowCount) throw new Error('图片数据库文件记录不存在或状态不可用');
      const outputUpdated = await client.query(`update app.generation_outputs set availability='available',content_status='approved',width=$2,height=$3,recovery_source_ciphertext=null
        where id=$1 and availability='awaiting'`, [row.output_id, file.width || null, file.height || null]);
      if (!outputUpdated.rowCount) throw new Error('图片输出槽位状态已变化');
      const finished = await client.query(`select app.finish_file_job($1,$2,$3) as finished`, [job.id, job.leaseOwner, job.leaseVersion]);
      if (!finished.rows[0]?.finished) throw new Error('图片恢复任务租约已失效');
      await client.query('commit');
      return { taskId: row.task_id, outputId: row.output_id };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function failGeneratedOutputRecoveryJob(job, errorCode = 'source_unavailable', maxAttempts = 8) {
    const me = await getUser(job.appwriteUserId);
    if (!me) throw new Error('用户不存在，请重新登录');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.user_id',$1,true)`, [me.internal_user_id]);
      const retry = await client.query(`select * from app.retry_file_job($1,$2,$3,$4,$5)`,
        [job.id, job.leaseOwner, job.leaseVersion, String(errorCode), maxAttempts]);
      const status = retry.rows[0]?.status;
      if (status === 'needs_attention') {
        const output = await client.query(`update app.generation_outputs set availability='unavailable',recovery_source_ciphertext=null
          where id=$1 and workspace_id=$2 and availability='awaiting' returning task_id,file_id`, [job.generationOutputId, me.workspace_id]);
        if (output.rowCount) {
          await client.query(`update app.file_objects set status='failed',last_error_code=$2,updated_at=now() where id=$1 and status='pending'`,
            [output.rows[0].file_id, String(errorCode).slice(0,120)]);
          const pending = await client.query(`select 1 from app.generation_outputs where task_id=$1 and workspace_id=$2 and availability='awaiting' limit 1`,
            [output.rows[0].task_id, me.workspace_id]);
          if (!pending.rowCount) {
            const task = await client.query(`select task_type from app.generation_tasks where id=$1 and workspace_id=$2 for update`,
              [output.rows[0].task_id, me.workspace_id]);
            const saved = await client.query(`select coalesce(jsonb_agg(jsonb_build_object('type',o.output_type,'index',o.output_index,'fileId',f.id,
                'objectKey',f.object_key,'mimeType',f.mime_type,'sizeBytes',f.size_bytes,'width',f.width,'height',f.height,
                'durationMs',f.duration_ms,'revisedPrompt',o.metadata->>'revisedPrompt') order by o.output_index),'[]'::jsonb) value
              from app.generation_outputs o join app.file_objects f on f.id=o.file_id and f.workspace_id=o.workspace_id and f.status='ready'
              where o.task_id=$1 and o.workspace_id=$2 and o.output_type=$3 and o.availability='available'`,
            [output.rows[0].task_id, me.workspace_id, task.rows[0]?.task_type || 'image']);
            await client.query(`update app.generation_tasks set outputs=$2::jsonb where id=$1`, [output.rows[0].task_id, JSON.stringify(saved.rows[0].value || [])]);
    if (['video','audio'].includes(task.rows[0]?.task_type)) {
              await client.query(`select app.fail_generation_task_keep_charge($1,'output_unrecoverable','媒体已生成但保存不可恢复；本次扣点保留')`, [output.rows[0].task_id]);
            } else {
              await client.query(`select app.fail_generation_task($1,'output_unrecoverable','图片保存失败，已退还本次预扣额度',true)`, [output.rows[0].task_id]);
            }
          }
        }
      }
      await client.query('commit');
      return { status, delaySeconds: Number(retry.rows[0]?.delay_seconds || 0) };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function settleGenerationTaskIfComplete(appwriteUserId, taskId, providerRef = null) {
    const me = await getUser(appwriteUserId);
    if (!me) throw new Error('用户不存在，请重新登录');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.user_id',$1,true)`, [me.internal_user_id]);
      const task = await client.query(`select id,status,task_type from app.generation_tasks where id=$1 and workspace_id=$2 and created_by=$3 for update`,
        [taskId, me.workspace_id, me.internal_user_id]);
      if (!task.rowCount) throw new Error('任务不存在或无权访问');
      if (['succeeded','failed','refunded'].includes(task.rows[0].status)) { await client.query('commit'); return apiTask(task.rows[0]); }
      const counts = await client.query(`select count(*) total,count(*) filter(where availability='awaiting') pending,
          count(*) filter(where availability='unavailable') unavailable
        from app.generation_outputs where task_id=$1 and workspace_id=$2 and attempt_id=(
          select id from app.generation_attempts where task_id=$1 and workspace_id=$2 order by attempt_no desc limit 1)
        and output_type=$3`, [taskId, me.workspace_id, task.rows[0].task_type]);
      const { total, pending, unavailable } = counts.rows[0];
      if (Number(pending) > 0) {
        if (task.rows[0].status === 'running') await client.query(`select app.mark_generation_task_saving($1)`, [taskId]);
        const current = await client.query(`select * from app.generation_tasks where id=$1`, [taskId]);
        await client.query('commit');
        return apiTask(current.rows[0]);
      }
      if (Number(total) === 0 || Number(unavailable) > 0) {
        const saved = await client.query(`select coalesce(jsonb_agg(jsonb_build_object('type',o.output_type,'index',o.output_index,'fileId',f.id,
            'objectKey',f.object_key,'sizeBytes',f.size_bytes,'mimeType',f.mime_type,'width',f.width,'height',f.height,
            'durationMs',f.duration_ms,'revisedPrompt',o.metadata->>'revisedPrompt') order by o.output_index),'[]'::jsonb) value
          from app.generation_outputs o join app.file_objects f on f.id=o.file_id and f.workspace_id=o.workspace_id and f.status='ready'
          where o.task_id=$1 and o.workspace_id=$2 and o.output_type=$3 and o.availability='available'`, [taskId, me.workspace_id, task.rows[0].task_type]);
        await client.query(`update app.generation_tasks set outputs=$2::jsonb where id=$1`, [taskId, JSON.stringify(saved.rows[0].value || [])]);
      const failed = ['video','audio','text'].includes(task.rows[0].task_type)
          ? await client.query(`select * from app.fail_generation_task_keep_charge($1,'output_unrecoverable','媒体已生成但未能完整保存；本次扣点保留')`, [taskId])
          : await client.query(`select * from app.fail_generation_task($1,'output_unrecoverable','图片未能完整保存，本次预扣额度已退回',true)`, [taskId]);
        await client.query('commit');
        return apiTask(failed.rows[0]);
      }
      const outputs = await client.query(`select coalesce(jsonb_agg(jsonb_build_object('type',o.output_type,'index',o.output_index,'fileId',f.id,
          'objectKey',f.object_key,'sizeBytes',f.size_bytes,'mimeType',f.mime_type,'width',f.width,'height',f.height,
          'durationMs',f.duration_ms,'revisedPrompt',o.metadata->>'revisedPrompt') order by o.output_index),'[]'::jsonb) value
        from app.generation_outputs o join app.file_objects f on f.id=o.file_id and f.workspace_id=o.workspace_id and f.status='ready'
        where o.task_id=$1 and o.workspace_id=$2 and o.output_type=$3 and o.availability='available'
          and o.attempt_id=(select id from app.generation_attempts where task_id=$1 and workspace_id=$2 order by attempt_no desc limit 1)`,
      [taskId, me.workspace_id, task.rows[0].task_type]);
      const settled = await client.query(`select * from app.settle_generation_task_success($1,$2::jsonb,$3)`,
        [taskId, JSON.stringify(outputs.rows[0].value || []), providerRef]);
      await client.query('commit');
      return apiTask(settled.rows[0]);
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function finishFileUploadRecoveryJob(job) {
    const result = await pool.query(`select app.finish_file_job($1,$2,$3) as finished`, [job.id, job.leaseOwner, job.leaseVersion]);
    if (!result.rows[0]?.finished) throw new Error('文件恢复作业租约已失效');
    return true;
  }

  async function cancelFileUploadRecoveryJob(job) {
    const result = await pool.query(`select app.cancel_file_job($1,$2,$3) as cancelled`, [job.id, job.leaseOwner, job.leaseVersion]);
    if (!result.rows[0]?.cancelled) throw new Error('文件恢复作业租约已失效');
    return true;
  }

  async function retryFileUploadRecoveryJob(job, errorCode = 'persist_failed', maxAttempts = 8) {
    const result = await pool.query(`select * from app.retry_file_job($1,$2,$3,$4,$5)`,
      [job.id, job.leaseOwner, job.leaseVersion, String(errorCode), maxAttempts]);
    if (!result.rowCount) throw new Error('文件恢复作业租约已失效');
    return { status: result.rows[0].status, delaySeconds: Number(result.rows[0].delay_seconds) };
  }

  async function createAssetFromFile(appwriteUserId, file) {
    const title = String(file.title || '').trim();
    const assetType = String(file.assetType || 'file').trim().toLowerCase();
    if (!title || title.length > 240) throw new Error('文件名称不能为空且不能超过240个字符');
    if (!['image','video','audio','doc','file'].includes(assetType)) throw new Error('不支持的资产类型');
    if (file.storageProvider !== 'cos' || !file.bucket || !file.objectKey || !file.fileId) throw new Error('文件缺少有效的 COS 存储记录');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const userId = await setWorkspaceUserContext(client, appwriteUserId);
      const owner = await client.query(`select u.id,w.id workspace_id from app.user_accounts u join app.workspaces w on w.owner_user_id=u.id and w.type='personal' and w.status='active' where u.id=$1 and u.status='active'`, [userId]);
      if (!owner.rowCount) throw new Error('用户不存在，请重新登录');
      const workspaceId = owner.rows[0].workspace_id;
      if (file.workspaceId && file.workspaceId !== workspaceId) throw new Error('上传期间工作空间已变化，请重新上传');
      const metadata = file.metadata && typeof file.metadata === 'object' ? file.metadata : {};
      const sourceKind = ['generated', 'reference_upload', 'manual_upload', 'edited', 'derived'].includes(file.sourceKind || metadata.sourceKind)
        ? (file.sourceKind || metadata.sourceKind) : 'manual_upload';
      const mediaType = ['image', 'video', 'audio', 'text', 'document', 'other'].includes(file.mediaType)
        ? file.mediaType : 'other';
      const editId = sourceKind === 'edited' ? String(metadata.editId || '') : null;
      const sourceFileId = ['edited', 'derived'].includes(sourceKind) ? String(file.sourceFileId || metadata.sourceFileId || '').toLowerCase() : null;
      const previewVariant = sourceKind === 'derived' ? String(file.previewVariant || metadata.previewVariant || '') : null;
      const idempotencyKey = String(file.idempotencyKey || metadata.writeIdempotencyKey || '').trim();
      if (idempotencyKey && idempotencyKey.length > 160) throw new Error('文件保存编号不能超过160个字符');
      if (sourceKind === 'edited') {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(editId) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceFileId)) throw new Error('编辑来源记录无效');
        const source = await client.query(`select 1 from app.content_edits ce join app.content_edit_inputs cei on cei.edit_id=ce.id and cei.workspace_id=ce.workspace_id
          join app.file_objects f on f.id=cei.file_id and f.workspace_id=cei.workspace_id and f.status='ready'
          where ce.id=$1 and ce.workspace_id=$2 and ce.created_by=$3 and cei.file_id=$4 and cei.role='base'`, [editId, workspaceId, owner.rows[0].id, sourceFileId]);
        if (!source.rowCount) throw new Error('编辑记录或原始素材不存在、未就绪或不属于当前用户');
      }
      if (sourceKind === 'derived') {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceFileId)
          || !isAssetPreviewVariant(previewVariant) || mediaType !== 'image') throw new Error('预览文件必须是图片，并提供有效的原文件编号和预览规格');
        const source = await client.query(`select 1 from app.file_objects where id=$1 and workspace_id=$2 and status='ready'
          and ($3 <> 'video-cover' or media_type='video')`, [sourceFileId, workspaceId, previewVariant]);
        if (!source.rowCount) throw new Error('预览原文件不存在、未就绪或类型不匹配');
      }
      if (sourceKind === 'derived' && idempotencyKey && !file.uploadSessionId) {
        const existing = await client.query(`select id,object_key,checksum,size_bytes,source_file_id,preview_variant,status
          from app.file_objects where workspace_id=$1 and write_idempotency_key=$2 for update`, [workspaceId, idempotencyKey]);
        if (existing.rowCount) {
          const prior = existing.rows[0];
          if (prior.status !== 'ready' || String(prior.checksum || '') !== String(file.checksum || '')
            || Number(prior.size_bytes) !== Number(file.sizeBytes) || String(prior.source_file_id || '').toLowerCase() !== sourceFileId
            || prior.preview_variant !== previewVariant) throw new Error('同一文件保存编号不能用于不同内容或来源');
          await client.query('commit');
          return { id: prior.id, fileId: prior.id, name: title, type: 'file', derived: true, objectKey: prior.object_key, reused: true };
        }
      }
      if (idempotencyKey && !file.uploadSessionId) {
        const existing = await client.query(`select a.id,a.title,a.asset_type,a.visibility,a.status,a.created_at,a.updated_at,
            f.object_key,f.checksum,f.size_bytes,f.source_kind,f.edit_id,f.source_file_id,f.preview_variant,f.status file_status
          from app.file_objects f
          join app.asset_files af on af.file_id=f.id and af.workspace_id=f.workspace_id and af.role='source'
          join app.asset_versions av on av.id=af.asset_version_id and av.workspace_id=f.workspace_id
          join app.assets a on a.id=av.asset_id and a.workspace_id=f.workspace_id
          where f.workspace_id=$1 and f.write_idempotency_key=$2
          order by av.version_no desc limit 1 for update of f`, [workspaceId, idempotencyKey]);
        if (existing.rowCount) {
          const prior = existing.rows[0];
          if (prior.file_status !== 'ready' || prior.status !== 'active') throw new Error('同一文件仍在保存，请稍后重试');
          if (String(prior.checksum || '') !== String(file.checksum || '') || Number(prior.size_bytes) !== Number(file.sizeBytes)
            || prior.source_kind !== sourceKind || String(prior.edit_id || '') !== String(editId || '')
            || String(prior.source_file_id || '') !== String(sourceFileId || '')
            || String(prior.preview_variant || '') !== String(previewVariant || '')) {
            throw new Error('同一文件保存编号不能用于不同内容或来源');
          }
          await client.query('commit');
          return { id: prior.id, name: prior.title, type: prior.asset_type, visibility: prior.visibility, favorited: false,
            createdAt: new Date(prior.created_at).toISOString(), updatedAt: new Date(prior.updated_at).toISOString(),
            objectKey: prior.object_key, reused: true };
        }
      }
      let uploadBatchId = ['generated','edited','derived'].includes(sourceKind) ? null : (file.uploadBatchId || crypto.randomUUID());
      let pendingUpload = null;
      if (file.uploadSessionId) {
        const pending = await client.query(`select s.id,s.status,s.file_id,s.workspace_id,f.bucket,f.object_key,f.size_bytes,f.upload_batch_id,f.source_kind,f.edit_id,f.source_file_id,f.preview_variant,f.write_idempotency_key
          from app.upload_sessions s join app.file_objects f on f.id=s.file_id and f.workspace_id=s.workspace_id
          where s.id=$1 and s.file_id=$2 for update of s,f`, [file.uploadSessionId, file.fileId]);
        if (!pending.rowCount || pending.rows[0].status !== 'completing' || pending.rows[0].workspace_id !== workspaceId) throw new Error('上传会话状态不允许完成或归属不匹配');
        pendingUpload = pending.rows[0];
        if (pendingUpload.bucket !== file.bucket || pendingUpload.object_key !== file.objectKey || Number(pendingUpload.size_bytes) !== Number(file.sizeBytes)) throw new Error('上传文件信息与会话登记不一致');
        if (pendingUpload.source_kind !== sourceKind || String(pendingUpload.edit_id || '') !== String(editId || '')
          || String(pendingUpload.source_file_id || '') !== String(sourceFileId || '')
          || String(pendingUpload.preview_variant || '') !== String(previewVariant || '')) throw new Error('上传会话的文件来源与完成请求不一致');
        if (String(pendingUpload.write_idempotency_key || '') !== idempotencyKey) throw new Error('上传会话的文件保存编号与完成请求不一致');
        uploadBatchId = pendingUpload.upload_batch_id;
      }
      if (uploadBatchId && !pendingUpload) {
        await ensureAssetUploadBatch(client, uploadBatchId, workspaceId, owner.rows[0].id);
      }
      const completeness = mediaType === 'text' ? (metadata.completeness === 'complete' ? 'complete' : 'partial') : null;
      const object = pendingUpload
        ? await client.query(`update app.file_objects set storage_version_id=$2,checksum=$3,status='ready',inspection_status='approved',updated_at=now()
            where id=$1 and workspace_id=$4 and status='pending' returning id`, [file.fileId, file.storageVersionId || null, file.checksum || null, workspaceId])
        : await client.query(`insert into app.file_objects(
        id,workspace_id,uploaded_by,storage_provider,bucket,object_key,storage_version_id,checksum,size_bytes,mime_type,status,
        media_type,source_kind,original_filename,upload_batch_id,width,height,duration_ms,completeness,inspection_status,write_idempotency_key,edit_id,source_file_id,preview_variant
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ready',$11,$12,$13,$14,$15,$16,$17,$18,'approved',$19,$20,$21,$22) returning id`, [
        file.fileId, workspaceId, owner.rows[0].id, file.storageProvider, file.bucket, file.objectKey,
        file.storageVersionId || null, file.checksum, file.sizeBytes, file.mimeType || 'application/octet-stream',
        mediaType, sourceKind, file.originalFilename || file.title || title, uploadBatchId,
        Number.isInteger(metadata.width) && metadata.width > 0 ? metadata.width : null,
        Number.isInteger(metadata.height) && metadata.height > 0 ? metadata.height : null,
        Number.isInteger(metadata.durationMs) && metadata.durationMs >= 0 ? metadata.durationMs : null,
        completeness, file.idempotencyKey || null, editId, sourceFileId, previewVariant,
      ]);
      if (!object.rowCount) throw new Error('待完成文件记录不存在或状态已变化');
      if (sourceKind === 'derived') {
        if (pendingUpload) {
          await client.query(`update app.file_jobs set status='cancelled'
            where upload_session_id=$1 and job_kind='persist' and status in ('queued','retry_wait')`, [file.uploadSessionId]);
          await client.query(`update app.upload_sessions set status='completed' where id=$1 and status='completing'`, [file.uploadSessionId]);
        }
        await client.query('commit');
        return { id: file.fileId, fileId: file.fileId, name: title, type: 'file', derived: true, objectKey: file.objectKey };
      }
      let generationTaskId = null;
      if (sourceKind === 'generated' && metadata.sourceGenerationTaskId) {
        const task = await client.query(`select id,task_type from app.generation_tasks where id=$1 and workspace_id=$2 and created_by=$3 and status='succeeded'`, [metadata.sourceGenerationTaskId, workspaceId, owner.rows[0].id]);
        if (!task.rowCount || task.rows[0].task_type !== mediaType) throw new Error('来源生成任务不存在、未成功、类型不匹配或不属于当前用户');
        generationTaskId = task.rows[0].id;
      }
      const asset = await client.query(`insert into app.assets(workspace_id,created_by,source_generation_id,asset_type,title,visibility,moderation_status,status) values($1,$2,$3,$4,$5,'private','approved','active') returning id,title,asset_type,visibility,status,created_at,updated_at`, [workspaceId, owner.rows[0].id, generationTaskId, assetType, title]);
      const versionMetadata = { ...metadata, mimeType: file.mimeType || 'application/octet-stream', sizeBytes: file.sizeBytes, checksum: file.checksum };
      const version = await client.query(`insert into app.asset_versions(asset_id,workspace_id,version_no,created_by,metadata) values($1,$2,1,$3,$4::jsonb) returning id`, [asset.rows[0].id, workspaceId, owner.rows[0].id, JSON.stringify(versionMetadata)]);
      await client.query(`insert into app.asset_files(asset_version_id,file_id,role,workspace_id) values($1,$2,'source',$3)`, [version.rows[0].id, object.rows[0].id, workspaceId]);
      if (generationTaskId) await client.query(`insert into app.generation_outputs(task_id,workspace_id,file_id,output_type,width,height,duration_ms,content_status,metadata) values($1,$2,$3,$4,$5,$6,$7,'approved',$8::jsonb)`, [generationTaskId, workspaceId, object.rows[0].id, mediaType, metadata.width || null, metadata.height || null, metadata.durationMs || null, JSON.stringify({ assetId: asset.rows[0].id, source: `${mediaType}_generation` })]);
      if (pendingUpload) await client.query(`update app.upload_sessions set status='completed' where id=$1 and status='completing'`, [file.uploadSessionId]);
      if (pendingUpload) await client.query(`update app.file_jobs set status='cancelled'
        where upload_session_id=$1 and job_kind='persist' and status in ('queued','retry_wait')`, [file.uploadSessionId]);
      await client.query(`insert into app.outbox_events(event_type,aggregate_type,aggregate_id,workspace_id,payload) values('asset.created','asset',$1,$2,$3::jsonb)`, [asset.rows[0].id, workspaceId, JSON.stringify({ title, assetType })]);
      await client.query('commit');
      return { id: asset.rows[0].id, name: asset.rows[0].title, type: asset.rows[0].asset_type, visibility: asset.rows[0].visibility, favorited: false, createdAt: new Date(asset.rows[0].created_at).toISOString(), updatedAt: new Date(asset.rows[0].updated_at).toISOString(), objectKey: file.objectKey };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function getAssetFile(appwriteUserId, assetId) {
    const client = await pool.connect();
    try {
    await client.query('begin');
    await setWorkspaceUserContext(client, appwriteUserId);
    const r = await client.query(`select a.title,f.storage_provider,f.bucket,f.object_key,f.mime_type,f.size_bytes,f.checksum
      from app.assets a join app.asset_versions v on v.asset_id=a.id and v.workspace_id=a.workspace_id and v.version_no=1
      join app.asset_files af on af.asset_version_id=v.id and af.workspace_id=a.workspace_id and af.role='source'
      join app.file_objects f on f.id=af.file_id and f.workspace_id=a.workspace_id
      where a.id=$1 and a.status in ('active','deleted') and f.status='ready' and exists(select 1 from app.workspaces w where w.id=a.workspace_id and (w.owner_user_id=(select id from app.user_accounts where appwrite_user_id=$2) or exists(select 1 from app.team_memberships tm where tm.team_id=w.team_id and tm.user_id=(select id from app.user_accounts where appwrite_user_id=$2) and tm.status='active'))) limit 1`, [assetId, appwriteUserId]);
    if (!r.rowCount) throw new Error('资产不存在或无权访问');
    const x = r.rows[0];
    await client.query('commit');
    return { title: x.title, storageProvider: x.storage_provider, bucket: x.bucket, objectKey: x.object_key, mimeType: x.mime_type || 'application/octet-stream', sizeBytes: Number(x.size_bytes || 0), checksum: x.checksum || '' };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function getDerivedFile(appwriteUserId, fileId) {
    const me = await getUser(appwriteUserId);
    if (!me) throw new Error('用户不存在，请重新登录');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.user_id',$1,true)`, [me.internal_user_id]);
      const file = await client.query(`select original_filename,storage_provider,bucket,object_key,mime_type,size_bytes,checksum
        from app.file_objects where id=$1 and workspace_id=$2 and source_kind='derived' and status='ready'`, [fileId, me.workspace_id]);
      if (!file.rowCount) throw new Error('预览文件不存在或无权访问');
      const row = file.rows[0];
      await client.query('commit');
      return { title: row.original_filename || '预览文件', storageProvider: row.storage_provider, bucket: row.bucket,
        objectKey: row.object_key, mimeType: row.mime_type || 'application/octet-stream', sizeBytes: Number(row.size_bytes || 0), checksum: row.checksum || '' };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function shareAssetToTeamWorkspace(appwriteUserId, assetId, targetWorkspaceId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetWorkspaceId)) throw new Error('团队工作空间编号无效');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await setWorkspaceUserContext(client, appwriteUserId);
      // 查原 asset：当前用户有读权限 + active
      const srcR = await client.query(`select a.id,a.title,a.asset_type,a.workspace_id,
          f.storage_provider,f.bucket,f.object_key,f.mime_type,f.size_bytes,f.checksum,f.media_type,f.original_filename,f.source_kind,
          v.metadata
        from app.assets a
        join app.asset_versions v on v.asset_id=a.id and v.workspace_id=a.workspace_id and v.version_no=1
        join app.asset_files af on af.asset_version_id=v.id and af.workspace_id=a.workspace_id and af.role='source'
        join app.file_objects f on f.id=af.file_id and f.workspace_id=a.workspace_id
        where a.id=$1 and a.status='active' and f.status='ready'
          and exists(select 1 from app.workspaces w where w.id=a.workspace_id and (w.owner_user_id=(select id from app.user_accounts where appwrite_user_id=$2) or exists(select 1 from app.team_memberships tm where tm.team_id=w.team_id and tm.user_id=(select id from app.user_accounts where appwrite_user_id=$2) and tm.status='active'))) limit 1`, [assetId, appwriteUserId]);
      if (!srcR.rowCount) throw new Error('原素材不存在或无权访问');
      const s = srcR.rows[0];
      // 验证目标 workspace：type=team 且当前用户是 active 成员
      const tw = await client.query(`select w.id from app.workspaces w where w.id=$1 and w.type='team' and w.status='active'
        and exists(select 1 from app.team_memberships tm where tm.team_id=w.team_id and tm.user_id=(select id from app.user_accounts where appwrite_user_id=$2) and tm.status='active')`, [targetWorkspaceId, appwriteUserId]);
      if (!tw.rowCount) throw new Error('团队工作空间不存在或你不是该团队成员');
      const internalUserId = (await client.query('select id from app.user_accounts where appwrite_user_id=$1', [appwriteUserId])).rows[0].id;
      // 幂等：同 asset 已经分享到这个团队 workspace 过
      const dup = await client.query(`select a.id from app.assets a
        join app.asset_versions v on v.asset_id=a.id and v.workspace_id=a.workspace_id and v.version_no=1
        where a.workspace_id=$1 and v.metadata->>'sharedFromAssetId'=$2 and a.status='active' limit 1`, [targetWorkspaceId, String(assetId)]);
      if (dup.rowCount) { await client.query('commit'); return { id: dup.rows[0].id, reused: true }; }
      // 新建 file_objects（同 bucket/object_key，新 id）
      const newFileId = crypto.randomUUID();
      await client.query(`insert into app.file_objects(id,workspace_id,uploaded_by,storage_provider,bucket,object_key,mime_type,size_bytes,checksum,status,media_type,original_filename,source_kind,inspection_status)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,'ready',$10,$11,$12,'approved')`,
        [newFileId, targetWorkspaceId, internalUserId, s.storage_provider, s.bucket, s.object_key, s.mime_type, s.size_bytes, s.checksum, s.media_type, s.original_filename || s.title, s.source_kind || 'manual_upload']);
      // 新建 asset
      const newAsset = await client.query(`insert into app.assets(workspace_id,created_by,asset_type,title,visibility,moderation_status,status)
        values($1,$2,$3,$4,'private','approved','active') returning id,title,asset_type`, [targetWorkspaceId, internalUserId, s.asset_type, s.title]);
      // 新建 asset_version
      const versionMeta = { ...(s.metadata || {}), sharedFromAssetId: String(assetId), sharedFromWorkspaceId: String(s.workspace_id) };
      const newVersion = await client.query(`insert into app.asset_versions(asset_id,workspace_id,version_no,created_by,metadata) values($1,$2,1,$3,$4::jsonb) returning id`,
        [newAsset.rows[0].id, targetWorkspaceId, internalUserId, JSON.stringify(versionMeta)]);
      await client.query(`insert into app.asset_files(asset_version_id,file_id,role,workspace_id) values($1,$2,'source',$3)`,
        [newVersion.rows[0].id, newFileId, targetWorkspaceId]);
      await client.query(`insert into app.outbox_events(event_type,aggregate_type,aggregate_id,workspace_id,payload) values('asset.shared','asset',$1,$2,$3::jsonb)`,
        [newAsset.rows[0].id, targetWorkspaceId, JSON.stringify({ title: s.title, fromAssetId: String(assetId) })]);
      await client.query('commit');
      return { id: newAsset.rows[0].id, name: newAsset.rows[0].title, type: newAsset.rows[0].asset_type, reused: false };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  // ── 异步生图任务（0046）：创建即预占额度并返回 task，由后端 worker 异步调用上游 ──
  function apiTask(row) {
    if (!row) return null;
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      status: row.status,
      taskType: row.task_type,
      provider: row.provider || '',
      model: row.model || '',
      prompt: row.prompt || '',
      parameters: row.parameters || {},
      outputs: row.outputs || [],
      errorCode: row.error_code || null,
      errorMessage: row.error_message || null,
      requestId: row.request_id,
      createdAt: new Date(row.created_at).toISOString(),
      startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
      finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
      timeoutAt: row.timeout_at ? new Date(row.timeout_at).toISOString() : null,
      chargedCredits: Number(row.charged_credits || 0),
    };
  }

  async function createGenerationTask(appwriteUserId, input = {}) {
    const referenceAssetIds = Array.isArray(input.referenceAssetIds) ? input.referenceAssetIds.map(value => String(value).toLowerCase()) : [];
    if (referenceAssetIds.length > 100 || referenceAssetIds.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))) {
      throw new Error('参考素材编号无效或超过100个');
    }
    const client = await pool.connect();
    try {
      await client.query('begin');
      const userId = await setWorkspaceUserContext(client, appwriteUserId);
      const owner = await client.query(`select u.id,w.id workspace_id from app.user_accounts u
        join app.workspaces w on w.owner_user_id=u.id and w.type='personal' and w.status='active'
        where u.id=$1 and u.status='active'`, [userId]);
      if (!owner.rowCount) throw new Error('用户不存在，请重新登录');
      const workspaceId = owner.rows[0].workspace_id;
      const fileByAssetId = new Map();
      if (referenceAssetIds.length) {
        const refs = await client.query(`select a.id asset_id,af.file_id
          from app.assets a
          join lateral (select id from app.asset_versions where asset_id=a.id and workspace_id=a.workspace_id order by version_no desc limit 1) av on true
          join app.asset_files af on af.asset_version_id=av.id and af.workspace_id=a.workspace_id and af.role='source'
          join app.file_objects f on f.id=af.file_id and f.workspace_id=a.workspace_id and f.status='ready'
          where a.id=any($1::uuid[]) and a.workspace_id=$2 and a.status='active'`, [referenceAssetIds, workspaceId]);
        for (const row of refs.rows) fileByAssetId.set(String(row.asset_id), row.file_id);
        if (fileByAssetId.size !== new Set(referenceAssetIds).size) throw new Error('参考素材不存在、未就绪或不属于当前工作空间');
      }
      const idempotencyKey = String(input.idempotencyKey || `task:${crypto.randomUUID()}`).slice(0, 160);
      const quantity = Math.max(0, Math.min(15, Number(input.quantity) || 1));
      const existingTask = await client.query(`select id,requested_output_count from app.generation_tasks where workspace_id=$1 and idempotency_key=$2`, [workspaceId, idempotencyKey]);
      const r = await client.query(
        `select * from app.create_generation_task($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13)`,
        [workspaceId, userId, String(input.taskType || 'image').slice(0, 32),
         String(input.provider || '').slice(0, 80) || null, String(input.model || '').slice(0, 160) || null,
         String(input.pricingVersion || '').slice(0, 160) || null, String(input.prompt || '').slice(0, 4000),
         JSON.stringify(input.parameters || {}), quantity, idempotencyKey,
         Math.max(30, Number(input.timeoutSeconds) || 600), input.modelCatalogId || null, input.creditQuoteId || null]
      );
      const savedCount = r.rows[0].requested_output_count;
      if (savedCount != null && Number(savedCount) !== quantity) throw new Error('同一任务编号不能更换生成数量');
      if (savedCount == null) await client.query(`update app.generation_tasks set requested_output_count=$2 where id=$1`, [r.rows[0].id, quantity]);
      const currentInputs = await client.query(`select file_id from app.generation_inputs where task_id=$1 and workspace_id=$2 and role='reference' order by position`, [r.rows[0].id, workspaceId]);
      const requestedFileIds = referenceAssetIds.map(id => String(fileByAssetId.get(id)));
      if (existingTask.rowCount) {
        if (currentInputs.rows.length !== requestedFileIds.length || currentInputs.rows.some((row, index) => String(row.file_id) !== requestedFileIds[index])) {
          throw new Error('同一任务编号不能更换参考素材');
        }
      } else {
        for (const [position, assetId] of referenceAssetIds.entries()) {
          await client.query(`insert into app.generation_inputs(workspace_id,task_id,file_id,role,position,created_by)
            values($1,$2,$3,'reference',$4,$5)
            on conflict (task_id, role, position) do nothing`, [workspaceId, r.rows[0].id, fileByAssetId.get(assetId), position, userId]);
        }
      }
      const finalInputs = await client.query(`select file_id from app.generation_inputs where task_id=$1 and workspace_id=$2 and role='reference' order by position`, [r.rows[0].id, workspaceId]);
      if (finalInputs.rows.length !== requestedFileIds.length || finalInputs.rows.some((row, index) => String(row.file_id) !== requestedFileIds[index])) {
        throw new Error('同一任务编号不能更换参考素材');
      }
      await client.query('commit');
      return apiTask(r.rows[0]);
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  }

  async function listGenerationInputFiles(appwriteUserId, taskId) {
    const me = await getUser(appwriteUserId);
    if (!me) throw new Error('用户不存在，请重新登录');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.user_id',$1,true)`, [me.internal_user_id]);
      const result = await client.query(`select f.id file_id,f.workspace_id,f.storage_provider,f.bucket,f.object_key,
          f.mime_type,f.size_bytes,f.media_type
        from app.generation_tasks t
        join app.generation_inputs i on i.task_id=t.id and i.workspace_id=t.workspace_id and i.role='reference'
        join app.file_objects f on f.id=i.file_id and f.workspace_id=i.workspace_id and f.status='ready'
        where t.id=$1 and t.workspace_id=$2 and t.created_by=$3
        order by i.position`, [taskId, me.workspace_id, me.internal_user_id]);
      await client.query('commit');
      return result.rows.map(row => ({
        fileId: row.file_id,
        workspaceId: row.workspace_id,
        storageProvider: row.storage_provider,
        bucket: row.bucket,
        objectKey: row.object_key,
        mimeType: row.mime_type,
        sizeBytes: Number(row.size_bytes),
        mediaType: row.media_type,
      }));
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function getGenerationTask(appwriteUserId, taskId) {
    const me = await getUser(appwriteUserId);
    if (!me) throw new Error('用户不存在，请重新登录');
    const r = await pool.query(
      `select * from app.generation_tasks where id=$1 and workspace_id=$2`,
      [taskId, me.workspace_id]
    );
    if (!r.rowCount) throw new Error('任务不存在或无权访问');
    return apiTask(r.rows[0]);
  }

  async function settleTextTask(appwriteUserId, taskId, answer) {
    const me = await getUser(appwriteUserId);
    if (!me) throw new Error('用户不存在，请重新登录');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.user_id',$1,true)`, [me.internal_user_id]);
      const found = await client.query(`select * from app.generation_tasks where id=$1 and workspace_id=$2 and created_by=$3 and task_type='text' for update`, [taskId, me.workspace_id, me.internal_user_id]);
      if (!found.rowCount) throw new Error('问答任务不存在或无权访问');
      if (['succeeded','failed','refunded'].includes(found.rows[0].status)) { await client.query('commit'); return apiTask(found.rows[0]); }
      if (found.rows[0].status !== 'running') throw new Error('问答任务状态已变化，无法结算');
      const task = found.rows[0];
      const result = await client.query(`select * from app.settle_generation_task_success($1,$2::jsonb,$3)`,
        [taskId, JSON.stringify([{ type: 'text', index: 0, text: String(answer).slice(0, 100000) }]), null]);
      await client.query('commit');
      return apiTask(result.rows[0]);
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function listMyGenerationTasks(appwriteUserId, limit = 50) {
    const me = await getUser(appwriteUserId);
    if (!me) return [];
    const take = Math.min(200, Math.max(1, Number(limit) || 50));
    const r = await pool.query(
      `select * from app.generation_tasks where workspace_id=$1 order by created_at desc limit $2`,
      [me.workspace_id, take]
    );
    return r.rows.map(apiTask);
  }

  async function markTaskRunning(appwriteUserId, taskId, providerTaskId) {
    const me = await getUser(appwriteUserId);
    if (!me) throw new Error('用户不存在，请重新登录');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.user_id',$1,true)`, [me.internal_user_id]);
      // 领取与状态检查共用行锁；重复处理者等待首个事务提交后只能读到 running。
      const task = await client.query(`select status,timeout_at from app.generation_tasks
        where id=$1 and workspace_id=$2 and created_by=$3 for update`,
        [taskId, me.workspace_id, me.internal_user_id]);
      if (!task.rowCount) throw new Error('任务不存在或无权领取');
      if (task.rows[0].status !== 'pending' ||
          (task.rows[0].timeout_at && new Date(task.rows[0].timeout_at).getTime() <= Date.now())) {
        await client.query('commit');
        return false;
      }
      await client.query(`select app.mark_generation_task_running($1,$2)`, [taskId, providerTaskId || null]);
      await client.query('commit');
      return true;
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }
  async function settleTaskSuccess(appwriteUserId, taskId, outputs, providerRef) {
    const me = await getUser(appwriteUserId);
    if (!me) throw new Error('用户不存在，请重新登录');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.user_id',$1,true)`, [me.internal_user_id]);
      const r = await client.query(`select * from app.settle_generation_task_success($1,$2::jsonb,$3)`, [taskId, JSON.stringify(outputs || []), providerRef || null]);
      await client.query('commit');
      return apiTask(r.rows[0]);
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }
  async function failTask(appwriteUserId, taskId, errorCode, errorMessage, refund = true) {
    const me = await getUser(appwriteUserId);
    if (!me) throw new Error('用户不存在，请重新登录');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.user_id',$1,true)`, [me.internal_user_id]);
      const r = await client.query(`select * from app.fail_generation_task($1,$2,$3,$4)`, [taskId, errorCode || 'failed', errorMessage || '', !!refund]);
      await client.query('commit');
      return apiTask(r.rows[0]);
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  async function listGeneratedOutputs(appwriteUserId, taskId) {
    const me = await getUser(appwriteUserId);
    if (!me) throw new Error('用户不存在，请重新登录');
    const client = await pool.connect();
    try {
      await client.query(`select set_config('app.user_id',$1,true)`, [me.internal_user_id]);
      const r = await client.query(
          `select o.id as output_id, o.output_type, o.metadata, o.width, o.height, o.duration_ms,
                f.id as file_id, f.storage_provider, f.bucket, f.object_key, f.mime_type, f.size_bytes
           from app.generation_outputs o
           join app.file_objects f on f.id = o.file_id and f.workspace_id = o.workspace_id
          where o.task_id = $1 and o.workspace_id = $2 and o.availability = 'available' and f.status = 'ready'
          order by (o.metadata->>'index')::int nulls last, o.created_at asc`,
        [taskId, me.workspace_id]
      );
      return r.rows.map(x => ({
        index: x.metadata?.index != null ? Number(x.metadata.index) : null,
        outputId: x.output_id,
        type: x.output_type,
        fileId: x.file_id,
        objectKey: x.object_key,
        storageProvider: x.storage_provider,
        bucket: x.bucket,
        contentType: x.mime_type || 'application/octet-stream',
        sizeBytes: Number(x.size_bytes || 0),
        width: x.width,
        height: x.height,
        durationMs: x.duration_ms == null ? null : Number(x.duration_ms),
      }));
    } finally { client.release(); }
  }

  async function createAssetFromGeneratedOutput(appwriteUserId, taskId, outputIndex, title, metadata = {}) {
    const safeTitle = String(title || '').trim().slice(0, 240);
    if (!safeTitle || !Number.isInteger(outputIndex) || outputIndex < 0) throw new Error('生成素材参数无效');
    const sourceMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
    const versionMetadata = Object.fromEntries(Object.entries(sourceMetadata).filter(([key, value]) =>
      ['prompt','model','voice','format','speed','resolution','ratio','seconds','generateAudio','watermark','videoMode'].includes(key)
      && (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string')));
    if (typeof versionMetadata.prompt === 'string') versionMetadata.prompt = versionMetadata.prompt.slice(0, 4000);
    if (typeof versionMetadata.model === 'string') versionMetadata.model = versionMetadata.model.slice(0, 160);
    const client = await pool.connect();
    try {
      await client.query('begin');
      const userId = await setWorkspaceUserContext(client, appwriteUserId);
      const output = await client.query(`select o.id,o.metadata,o.output_type,o.workspace_id,o.task_id,
          f.id file_id,f.storage_provider,f.bucket,f.object_key,f.mime_type,f.size_bytes,f.width,f.height,f.duration_ms,
          t.created_by,t.status task_status
        from app.generation_outputs o join app.file_objects f on f.id=o.file_id and f.workspace_id=o.workspace_id
        join app.generation_tasks t on t.id=o.task_id and t.workspace_id=o.workspace_id
        where o.task_id=$1 and o.workspace_id=(select workspace_id from app.workspaces where owner_user_id=$2 and type='personal' and status='active')
          and o.output_index=$3 and o.availability='available' and o.output_type in ('video','audio')
          and f.status='ready' and t.created_by=$2 and t.status='succeeded'
        for update of o`, [taskId, userId, outputIndex]);
      if (!output.rowCount) throw new Error('已保存的媒体结果不存在或无权访问');
      const row = output.rows[0];
      const existingAssetId = row.metadata?.assetId;
      if (existingAssetId) {
        const existing = await client.query(`select id,title,asset_type,visibility,created_at,updated_at
          from app.assets where id=$1 and workspace_id=$2 and status='active'`, [existingAssetId, row.workspace_id]);
        if (existing.rowCount) {
          await client.query('commit');
          return { id: existing.rows[0].id, name: existing.rows[0].title, type: existing.rows[0].asset_type,
            visibility: existing.rows[0].visibility, favorited: false,
            createdAt: new Date(existing.rows[0].created_at).toISOString(), updatedAt: new Date(existing.rows[0].updated_at).toISOString(),
            objectKey: row.object_key, fileId: row.file_id, mimeType: row.mime_type, sizeBytes: Number(row.size_bytes || 0),
            width: row.width, height: row.height, durationMs: row.duration_ms == null ? null : Number(row.duration_ms) };
        }
      }
      const asset = await client.query(`insert into app.assets(workspace_id,created_by,source_generation_id,asset_type,title,visibility,moderation_status,status)
        values($1,$2,$3,$4,$5,'private','approved','active') returning id,title,asset_type,visibility,created_at,updated_at`,
      [row.workspace_id, userId, taskId, row.output_type, safeTitle]);
      const version = await client.query(`insert into app.asset_versions(asset_id,workspace_id,version_no,created_by,metadata)
        values($1,$2,1,$3,$4::jsonb) returning id`,
      [asset.rows[0].id, row.workspace_id, userId, JSON.stringify({ ...versionMetadata, mimeType: row.mime_type, sizeBytes: Number(row.size_bytes || 0), durationMs: row.duration_ms == null ? null : Number(row.duration_ms), sourceGenerationTaskId: taskId })]);
      await client.query(`insert into app.asset_files(asset_version_id,file_id,role,workspace_id) values($1,$2,'source',$3)`,
        [version.rows[0].id, row.file_id, row.workspace_id]);
      await client.query(`update app.generation_outputs set metadata=metadata||jsonb_build_object('assetId',$2::text) where id=$1`,
        [row.id, asset.rows[0].id]);
      await client.query(`insert into app.outbox_events(event_type,aggregate_type,aggregate_id,workspace_id,payload)
        values('asset.created','asset',$1,$2,$3::jsonb)`, [asset.rows[0].id, row.workspace_id, JSON.stringify({ title: safeTitle, assetType: row.output_type })]);
      await client.query('commit');
      return { id: asset.rows[0].id, name: asset.rows[0].title, type: asset.rows[0].asset_type, visibility: asset.rows[0].visibility,
        favorited: false, createdAt: new Date(asset.rows[0].created_at).toISOString(), updatedAt: new Date(asset.rows[0].updated_at).toISOString(),
        objectKey: row.object_key, fileId: row.file_id, mimeType: row.mime_type, sizeBytes: Number(row.size_bytes || 0),
        width: row.width, height: row.height, durationMs: row.duration_ms == null ? null : Number(row.duration_ms) };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }
  // 超时自动回收：在途任务→refunded，过期预占→expired，守恒异常→告警。
  async function reapStaleTasks() {
    const outputResult = await pool.query(`select app.reap_stale_generation_output_tasks() AS count`);
    const r = await pool.query(`select app.reap_stale_generation_tasks() AS result`);
    return { ...(r.rows[0]?.result || {}), refunded_output_tasks: Number(outputResult.rows[0]?.count || 0) };
  }

  // 启动恢复：找出本进程重启前残留的 pending 任务（尚未被任何 worker 领取且未超时），
  // 重新派发后台执行；否则这些任务要等到 timeout_at 才会被 reaper 退款，白白占额度。
  async function listRecoverableTasks(limit = 20) {
    const r = await pool.query(`select gt.*, u.appwrite_user_id, a.id recovery_attempt_id, a.provider_task_id recovery_provider_task_id
      from app.generation_tasks gt
      join app.user_accounts u on u.id = gt.created_by
      left join lateral (select id,provider_task_id from app.generation_attempts where task_id=gt.id order by attempt_no desc limit 1) a on true
      where gt.timeout_at > now() and (gt.status = 'pending'
        or (gt.task_type='video' and gt.status='running' and a.provider_task_id is not null))
      order by gt.created_at asc limit $1`, [Math.min(100, Math.max(1, Number(limit) || 20))]);
    return r.rows.map(row => ({ task: apiTask(row), appwriteUserId: row.appwrite_user_id,
      attemptId: row.recovery_attempt_id || null, providerTaskId: row.recovery_provider_task_id || null }));
  }


  // 管理员审计、对账、告警
  async function writeAdminAudit({ actor, action, workspaceId = null, targetType = null, targetId = null, summary = '', metadata = {}, ip = null }) {
    const r = await pool.query(
      `select app.write_admin_audit($1,$2,$3,$4,$5,$6,$7::jsonb,$8::inet) AS id`,
      [String(actor).slice(0, 160), String(action).slice(0, 120), workspaceId,
       targetType ? String(targetType).slice(0, 80) : null, targetId ? String(targetId).slice(0, 160) : null,
       String(summary || '').slice(0, 2000), JSON.stringify(metadata || {}), ip]
    );
    return r.rows[0]?.id;
  }
  async function listAdminAuditLogs({ limit = 200, search = null } = {}) {
    const r = await pool.query(
      `select * from app.list_admin_audit_logs($1,$2)`,
      [Number(limit) || 200, search ? String(search) : null]
    );
    return r.rows.map(x => ({
      id: x.id, workspaceId: x.workspace_id, actor: x.actor, action: x.action,
      targetType: x.target_type, targetId: x.target_id, summary: x.summary || '',
      metadata: x.metadata || {}, ip: x.ip ? String(x.ip) : null,
      createdAt: new Date(x.created_at).toISOString(),
    }));
  }
  async function adminReconciliation() {
    const r = await pool.query(
      `select q.*, w.owner_user_id, u.email as owner_email, u.appwrite_user_id
       from app.v_quota_reconciliation q
       join app.workspaces w on w.id=q.workspace_id
       join app.user_accounts u on u.id=w.owner_user_id
       order by abs(q.drift) desc nulls last`
    );
    return r.rows.map(x => ({
      workspaceId: x.workspace_id, ownerEmail: x.owner_email, quotaCode: x.quota_code,
      granted: Number(x.granted), reserved: Number(x.reserved), consumed: Number(x.consumed),
      available: Number(x.available), ledgerReserved: Number(x.ledger_reserved),
      ledgerCommitted: Number(x.ledger_committed), ledgerReleased: Number(x.ledger_released),
      drift: Number(x.drift || 0),
    }));
  }
  async function listAlerts(openOnly = true) {
    const r = await pool.query(
      `select id,alert_type,severity,workspace_id,summary,detail,status,created_at,acknowledged_at,acknowledged_by
       from app.platform_alerts ${openOnly ? `where status='open'` : ''} order by created_at desc limit 200`
    );
    return r.rows.map(x => ({
      id: x.id, type: x.alert_type, severity: x.severity, workspaceId: x.workspace_id,
      summary: x.summary, detail: x.detail || {}, status: x.status,
      createdAt: new Date(x.created_at).toISOString(), acknowledgedAt: x.acknowledged_at, acknowledgedBy: x.acknowledged_by,
    }));
  }
  async function ackAlert(alertId, actor) {
    const r = await pool.query(
      `update app.platform_alerts set status='ack', acknowledged_at=now(), acknowledged_by=$2
       where id=$1 and status<>'closed' returning id`, [alertId, String(actor).slice(0, 160)]);
    return r.rowCount === 1;
  }

  return { ensureAdminAccount, getAdminAccount, touchAdminLogin, changeAdminPassword, upgradeAdminPasswordHash, reserveAdminLoginAttempt, clearAdminLoginAttempts, ensureUser, registerSession, listSessions, isSessionActive, isSessionAdmitted, revokeSession, listSyncEvents, ackSyncCursor, getUser: async id => publicUser(await getUser(id)), createFeedback, recordProviderUsage, completeProviderUsage, recordPaymentEvent, processPaymentEvent, processRecoverablePaymentEvents, plans, updatePlan, getSystemSetting, setSystemSetting, getRenewalStatus, createOrder, payOrder, listOrders, createRefundRequest, listRefunds, adminRefunds, adminUpdateRefund, listTransactions, createInvoiceRequest, listMyInvoiceRequests, adminListInvoiceRequests, adminUpdateInvoiceRequest, adminUnknownUsage, adminReconcileUsage, adminStats, adminQuotaAudit, adminUsers, adminAdjustBalance, adminOrders, inviteInfo, redeemCode, adminListCodes, createContentEdit, listPlatformApiKeys, listPlatformApiKeysForRuntime, createPlatformApiKey, updatePlatformApiKey, deletePlatformApiKey, fetchPlatformApiKeyModels, listPlatformApiKeyStats, listPlatformApiKeyHistory, listPlatformApiKeyUsage, listModelCatalog, createModelCatalog, addModelCatalogChannelModel, removeModelCatalogChannelModel, listPublicModelCatalogChannels, listPlatformModelRoutes, bulkCreateModelCatalog, createModelCreditQuote, updateModelCatalog, deleteModelCatalog, saveCanvasSnapshot, listCanvasSnapshots, saveAgentSnapshot, listChatConversations, createChatConversation, getChatConversation, listChatMessages, appendChatMessage, updateChatConversation, deleteChatConversation, listTeams, createTeam, listTeamMembers, inviteToTeam, acceptTeamInvitation, updateTeamMember, listDepartments, createDepartment, createJobTitle, listAssets, listFavorites, deleteAsset, restoreAsset, toggleFavorite, toggleAssetLike, listAssetComments, createAssetComment, getAssetUploadScope, createAssetUploadSession, getAssetUploadSession, recordAssetUploadPart, beginAssetUploadCompletion, failAssetUploadSession, enqueueAssetUploadRecovery, claimFileUploadRecoveryJobs, finishFileUploadRecoveryJob, cancelFileUploadRecoveryJob, retryFileUploadRecoveryJob, getGenerationOutputRecoveryContext, finishGeneratedOutputRecoveryJob, failGeneratedOutputRecoveryJob, createAssetFromFile, createAssetFromGeneratedOutput, getAssetFile, getDerivedFile, shareAssetToTeamWorkspace, createGenerationTask, getGenerationTask, settleTextTask, listGenerationInputFiles, listMyGenerationTasks, markTaskRunning, beginGenerationAttempt, setGenerationAttemptProviderTask, reserveGeneratedOutput, completeGenerationAttempt, settleGenerationTaskIfComplete, settleTaskSuccess, failTask, recordGeneratedOutput, listGeneratedOutputs, reapStaleTasks, listRecoverableTasks, writeAdminAudit, listAdminAuditLogs, adminReconciliation, listAlerts, ackAlert, close: () => pool.end() };
}
