/**
 * 轻域AI API 后端服务
 * 功能：API 密钥管理、公开模型配置、AI 请求代理（服务端注入密钥）
 * 零依赖，仅用 Node.js 内置模块
 * 端口：3001
 */
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "api-data");
const KEYS_FILE = path.join(DATA_DIR, "keys.json");
const ADMIN_FILE = path.join(DATA_DIR, "admin.json");
// ===== 计费系统数据文件 =====
const USERS_FILE = path.join(DATA_DIR, "billing_users.json");       // 客户计费账本（按 Appwrite 用户 ID）
const ORDERS_FILE = path.join(DATA_DIR, "billing_orders.json");     // 订单
const CODES_FILE = path.join(DATA_DIR, "billing_codes.json");       // 兑换码
const TX_FILE = path.join(DATA_DIR, "billing_transactions.json");   // 流水
const PLANS_FILE = path.join(DATA_DIR, "billing_plans.json");       // 会员套餐
const SETTINGS_FILE = path.join(DATA_DIR, "billing_settings.json"); // 系统设置（支付开关等）
const PORT = process.env.PORT || 3001;
let postgresBilling = null;

// ---------- 数据存储 ----------
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); }
  catch { return fallback; }
}
function saveJSON(file, data) {
  // 先写临时文件，再原子替换正式文件。进程被杀或机器断电时不会留下半个 JSON。
  const tempFile = `${file}.${process.pid}.tmp`;
  const payload = JSON.stringify(data, null, 2);
  fs.writeFileSync(tempFile, payload, { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tempFile, file);
}

// 管理员账号（首次启动初始化）
let admin = loadJSON(ADMIN_FILE, null);
if (!admin) {
  admin = { username: "admin", password: hashPassword("QingyuAdmin2026!") };
  saveJSON(ADMIN_FILE, admin);
  console.log("[init] 管理员已初始化，用户名: admin，密码: QingyuAdmin2026!（请尽快修改）");
}

// API 密钥列表
let keys = loadJSON(KEYS_FILE, []);

// JWT 签名密钥
const JWT_SECRET = process.env.JWT_SECRET || "qingyu-api-jwt-secret-2026-change-me";

// ===================== 计费系统：数据加载与种子 =====================
let billingUsers = loadJSON(USERS_FILE, []);       // 客户账本数组
let billingOrders = loadJSON(ORDERS_FILE, []);     // 订单数组
let billingCodes = loadJSON(CODES_FILE, []);       // 兑换码数组
let billingTxs = loadJSON(TX_FILE, []);            // 流水数组
let billingPlans = loadJSON(PLANS_FILE, []);      // 套餐数组
let billingSettings = loadJSON(SETTINGS_FILE, null); // 设置

if (process.env.BILLING_STORE === "postgres") {
  const { createPostgresBillingStore } = await import("./postgres-billing-store.mjs");
  postgresBilling = await createPostgresBillingStore();
  console.log("[billing] PostgreSQL 计费存储已启用");
}

// 默认套餐（首次启动写入）
const DEFAULT_PLANS = [
  { id: "free",   name: "免费版", priceCents: 0,      durationDays: 0,   monthlyQuota: 0,     level: "free",
    description: "注册即用", features: ["每日 20 次对话", "3 个画布", "基础模型"] },
  { id: "pro",    name: "Pro",    priceCents: 2900,   durationDays: 30,  monthlyQuota: 50000, level: "pro",
    description: "个人创作者首选", features: ["每月 5 万积分", "全部模型", "50 个画布", "优先响应"] },
  { id: "team",   name: "团队版", priceCents: 9900,   durationDays: 30,  monthlyQuota: 300000, level: "team",
    description: "多人协作", features: ["每月 30 万积分", "无限画布", "团队协作", "专属支持"] },
];

if (!billingSettings) {
  billingSettings = {
    currency: "CNY",
    payEnabled: { mock: true, epay: false, wechat: false, alipay: false },
    inviteRewardCents: 0,          // 邀请人奖励（分），0 关闭
    inviteRewardQuota: 500,        // 邀请人奖励积分
    registeredBonusQuota: 100,     // 新注册赠送积分
  };
  saveJSON(SETTINGS_FILE, billingSettings);
}
if (!Array.isArray(billingPlans) || billingPlans.length === 0) {
  billingPlans = DEFAULT_PLANS.map(p => ({ ...p }));
  saveJSON(PLANS_FILE, billingPlans);
}

// ---- 计费辅助函数 ----
function findUserByAppwriteId(uid) {
  return billingUsers.find(u => u.id === uid) || null;
}
function upsertUser(uid, email) {
  let u = findUserByAppwriteId(uid);
  if (!u) {
    u = {
      id: uid,
      email: email || "",
      balance: billingSettings.registeredBonusQuota || 0,
      memberLevel: "free",
      memberExpireAt: 0,
      inviteCode: genInviteCode(uid),
      invitedBy: "",
      totalSpent: 0,
      createdAt: Date.now(),
    };
    billingUsers.push(u);
    saveJSON(USERS_FILE, billingUsers);
    if (u.balance > 0) {
      pushTx({ userId: uid, change: u.balance, type: "register", note: "新用户赠送" });
    }
  }
  return u;
}
function genInviteCode(uid) {
  // 8 位短码，基于 uid 哈希
  const h = crypto.createHash("sha1").update("invite_" + uid).digest("hex").toUpperCase();
  return h.slice(0, 4) + "-" + h.slice(4, 8);
}
function pushTx({ userId, change, type, orderId = "", note = "" }) {
  const u = findUserByAppwriteId(userId);
  const balanceAfter = u ? u.balance : 0;
  const tx = {
    id: "TX" + Date.now().toString(36) + crypto.randomBytes(2).toString("hex"),
    userId, change, balanceAfter, type, orderId, note,
    createdAt: Date.now(),
  };
  billingTxs.push(tx);
  saveJSON(TX_FILE, billingTxs);
  return tx;
}
function adjustBalance(uid, delta, type, orderId = "", note = "") {
  const u = findUserByAppwriteId(uid);
  if (!u) return null;
  u.balance = Math.max(0, (u.balance || 0) + delta);
  saveJSON(USERS_FILE, billingUsers);
  pushTx({ userId: uid, change: delta, type, orderId, note });
  return u;
}
function issueMembership(uid, plan) {
  const u = findUserByAppwriteId(uid);
  if (!u) return;
  const now = Date.now();
  // 在现有到期时间上续期（若未过期），否则从现在起算
  const base = u.memberExpireAt > now ? u.memberExpireAt : now;
  u.memberLevel = plan.level;
  u.memberExpireAt = base + plan.durationDays * 24 * 3600 * 1000;
  // 会员套餐赠送额度
  if (plan.monthlyQuota) {
    u.balance = (u.balance || 0) + plan.monthlyQuota;
  }
  saveJSON(USERS_FILE, billingUsers);
  if (plan.monthlyQuota) pushTx({ userId: uid, change: plan.monthlyQuota, type: "membership", note: `开通${plan.name}赠送额度` });
}
function newOrderId() {
  return "O" + Date.now().toString(36) + crypto.randomBytes(3).toString("hex").toUpperCase();
}
function genRedeemCode() {
  const seg = () => crypto.randomBytes(3).toString("hex").toUpperCase();
  return "QY-" + seg() + "-" + seg() + "-" + seg();
}
// 校验客户计费 JWT（区分管理员与普通客户）
function getBillingIdentity(req) {
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const payload = verifyJWT(token);
  if (!payload) return null;
  return payload; // { sub, role, exp }
}


function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function signJWT(payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const h = base64url(JSON.stringify(header));
  const p = base64url(JSON.stringify(payload));
  const data = `${h}.${p}`;
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(data).digest();
  return `${data}.${base64url(sig)}`;
}

function verifyJWT(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const data = `${parts[0]}.${parts[1]}`;
    const expectedSig = base64url(crypto.createHmac("sha256", JWT_SECRET).update(data).digest());
    if (expectedSig !== parts[2]) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch { return null; }
}

// ---------- 工具函数 ----------
function hashPassword(pw) {
  return crypto.createHash("sha256").update(pw + "qingyu_salt_2026").digest("hex");
}

function maskKey(key) {
  if (!key || key.length <= 8) return "****";
  return key.slice(0, 4) + "..." + key.slice(-4);
}

function verifyToken(req) {
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return false;
  return verifyJWT(token) !== null;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(new Error("JSON 解析失败")); }
    });
    req.on("error", reject);
  });
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  });
  res.end(body);
}

function nextId() {
  return keys.length > 0 ? Math.max(...keys.map(k => k.id)) + 1 : 1;
}

// 根据模型名找到对应渠道（模型名格式: channelId::modelName 或纯 modelName）
function findChannel(modelName) {
  if (!modelName) return null;
  // 优先解析 channelId::modelName 格式
  if (modelName.includes("::")) {
    const [cid, ...rest] = modelName.split("::");
    const id = parseInt(cid, 10);
    const ch = keys.find(k => k.id === id && k.is_active === 1);
    if (ch) return { channel: ch, model: rest.join("::") };
  }
  // 回退：找第一个包含此模型的活跃渠道
  for (const k of keys) {
    if (k.is_active !== 1) continue;
    const models = (k.model || "").split(",").map(m => m.trim());
    if (models.includes(modelName)) return { channel: k, model: modelName };
  }
  // 再回退：第一个活跃渠道
  const first = keys.find(k => k.is_active === 1);
  if (first) return { channel: first, model: modelName };
  return null;
}

// ---------- AI 请求代理 ----------
function proxyRequest(req, res, targetPath) {
  let bodyChunks = [];
  req.on("data", chunk => bodyChunks.push(chunk));
  req.on("end", async () => {
    const rawBody = Buffer.concat(bodyChunks).toString("utf-8");
    let bodyObj = {};
    try { bodyObj = rawBody ? JSON.parse(rawBody) : {}; } catch { bodyObj = {}; }

    const modelField = bodyObj.model || "";
    const match = findChannel(modelField);
    if (!match) {
      return sendJSON(res, 502, { error: "没有可用的 API 渠道，请先在管理后台添加并启用 API Key" });
    }
    const { channel, model } = match;

    // 替换模型名为纯模型名（去掉 channelId 前缀）
    if (modelField.includes("::")) {
      bodyObj.model = model;
    }
    const forwardBody = JSON.stringify(bodyObj);

    // 构建目标 URL
    let base = channel.base_url.replace(/\/+$/, "");
    // 如果 base_url 已经以 /v1 结尾，targetPath 可能是 /chat/completions，直接拼接
    // targetPath 来自 /api/proxy/openai/*，即 * 部分
    const targetUrl = base + targetPath;

    const url = new URL(targetUrl);
    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : http;

    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${channel.api_key}`,
      "Content-Length": Buffer.byteLength(forwardBody),
      "Accept": "text/event-stream, application/json",
    };
    // 透传必要的请求头
    if (req.headers["accept"]) headers["Accept"] = req.headers["accept"];

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: req.method,
      headers,
      timeout: 120000,
    };

    const proxyReq = lib.request(options, proxyRes => {
      // 透传响应头
      const respHeaders = { ...proxyRes.headers };
      respHeaders["Access-Control-Allow-Origin"] = "*";
      res.writeHead(proxyRes.statusCode || 502, respHeaders);
      proxyRes.pipe(res);
    });

    proxyReq.on("error", err => {
      console.error("[proxy error]", err.message);
      if (!res.headersSent) {
        sendJSON(res, 502, { error: "代理请求失败: " + err.message });
      }
    });

    proxyReq.on("timeout", () => {
      proxyReq.destroy();
      if (!res.headersSent) sendJSON(res, 504, { error: "上游请求超时" });
    });

    proxyReq.write(forwardBody);
    proxyReq.end();
  });
}

// ===================== 计费路由处理器 =====================
// 返回 true 表示已处理
async function handleBilling(req, res, pathname, method, url) {

  // ---------- 客户端：/api/billing/* ----------
  if (pathname.startsWith("/api/billing/") || pathname === "/api/billing") {

    // POST /api/billing/login — 用 Appwrite 用户 ID 换取客户计费 JWT（前端在 Appwrite 登录成功后调用）
    if (pathname === "/api/billing/login" && method === "POST") {
      const body = await parseBody(req);
      if (!body.userId) return sendJSON(res, 400, { error: "缺少用户标识" });
      if (postgresBilling) {
        const user = await postgresBilling.ensureUser(body.userId, body.email || "", body.inviteCode || "");
        const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
        const token = signJWT({ sub: body.userId, role: "customer", iat: Math.floor(Date.now() / 1000), exp });
        return sendJSON(res, 200, { token, user });
      }
      const user = upsertUser(body.userId, body.email || "");
      // 邀请人绑定（仅首次）
      if (!user.invitedBy && body.inviteCode) {
        const inviter = billingUsers.find(u => u.inviteCode === body.inviteCode);
        if (inviter && inviter.id !== user.id) {
          user.invitedBy = inviter.id;
          saveJSON(USERS_FILE, billingUsers);
        }
      }
      const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
      const token = signJWT({ sub: user.id, role: "customer", iat: Math.floor(Date.now() / 1000), exp });
      return sendJSON(res, 200, { token, user: publicUser(user) });
    }

    // 以下客户接口都需要客户 JWT
    const identity = getBillingIdentity(req);
    if (!identity || identity.role !== "customer") {
      return sendJSON(res, 401, { error: "未登录或登录已过期" });
    }
    const me = postgresBilling ? await postgresBilling.getUser(identity.sub) : findUserByAppwriteId(identity.sub);
    if (!me) return sendJSON(res, 404, { error: "用户不存在，请重新登录" });

    // GET /api/billing/me
    if (pathname === "/api/billing/me" && method === "GET") {
      if (postgresBilling) return sendJSON(res, 200, { user: me, settings: { currency: "CNY", inviteCode: me.inviteCode, inviteRewardQuota: 0 } });
      return sendJSON(res, 200, { user: publicUser(me), settings: {
        currency: billingSettings.currency,
        inviteCode: me.inviteCode,
        inviteRewardQuota: billingSettings.inviteRewardQuota,
      }});
    }

    // GET /api/billing/plans — 公开套餐
    if (pathname === "/api/billing/plans" && method === "GET") {
      if (postgresBilling) return sendJSON(res, 200, await postgresBilling.plans());
      return sendJSON(res, 200, billingPlans);
    }

    // POST /api/billing/orders — 创建订单 { planId, idempotencyKey }
    if (pathname === "/api/billing/orders" && method === "POST") {
      const body = await parseBody(req);
      if (postgresBilling) {
        const requestedKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
        if (requestedKey && (requestedKey.length < 16 || requestedKey.length > 200)) return sendJSON(res, 400, { error: "订单幂等编号无效，请重试" });
        const key = requestedKey || `legacy_${crypto.createHash("sha256").update(`${identity.sub}:${body.planId}:${Math.floor(Date.now() / (15 * 60 * 1000))}`).digest("hex").slice(0, 48)}`;
        try { return sendJSON(res, 200, await postgresBilling.createOrder(identity.sub, body.planId, key, body.method || "mock")); }
        catch (error) { return sendJSON(res, error.message.includes("同一") ? 409 : 400, { error: error.message }); }
      }
      const plan = billingPlans.find(p => p.id === body.planId);
      if (!plan) return sendJSON(res, 400, { error: "套餐不存在" });
      if (plan.priceCents <= 0) return sendJSON(res, 400, { error: "免费套餐无需下单" });
      const requestedKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
      if (requestedKey && (requestedKey.length < 16 || requestedKey.length > 200)) {
        return sendJSON(res, 400, { error: "订单幂等编号无效，请重试" });
      }
      // 兼容尚未升级的前端：没有编号时按用户、套餐和 15 分钟窗口生成稳定编号。
      const windowKey = Math.floor(Date.now() / (15 * 60 * 1000));
      const legacySeed = `${me.id}:${plan.id}:${windowKey}`;
      const idempotencyKey = requestedKey || `legacy_${crypto.createHash("sha256").update(legacySeed).digest("hex").slice(0, 48)}`;
      // 网络超时后客户端会用同一个编号重试；必须返回原订单，不能再创建一笔。
      const sameRequest = billingOrders.find(o => o.userId === me.id &&
        (o.idempotencyKey === idempotencyKey || o.requestKeys?.includes(idempotencyKey)));
      if (sameRequest) {
        if (sameRequest.planId !== plan.id) return sendJSON(res, 409, { error: "同一购买编号不能用于不同套餐" });
        return sendJSON(res, 200, sameRequest);
      }
      // 开通入口不是续费入口：已有有效会员时只返回原来的成功订单。
      if (me.memberLevel === plan.level && me.memberExpireAt > Date.now()) {
        const paid = billingOrders.filter(o => o.userId === me.id && o.planId === plan.id && o.status === "paid")
          .sort((a, b) => b.paidAt - a.paidAt)[0];
        if (paid) return sendJSON(res, 200, paid);
        return sendJSON(res, 409, { error: "此套餐已生效，无需重复开通" });
      }
      // 页面刷新后编号可能丢失：同一用户同一套餐的短期未付款单继续使用，避免重复弹出收银台。
      const pendingCutoff = Date.now() - 15 * 60 * 1000;
      const recentPending = billingOrders
        .filter(o => o.userId === me.id && o.planId === plan.id && o.status === "pending" && o.createdAt >= pendingCutoff)
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      if (recentPending) {
        recentPending.requestKeys = [...new Set([...(recentPending.requestKeys || []), idempotencyKey])];
        saveJSON(ORDERS_FILE, billingOrders);
        return sendJSON(res, 200, recentPending);
      }
      const order = {
        id: newOrderId(),
        userId: me.id,
        type: "membership",
        planId: plan.id,
        amountCents: plan.priceCents,
        status: "pending",
        paymentMethod: body.method || "mock",
        transactionId: "",
        idempotencyKey,
        createdAt: Date.now(),
        paidAt: 0,
      };
      billingOrders.push(order);
      saveJSON(ORDERS_FILE, billingOrders);
      return sendJSON(res, 200, order);
    }

    // POST /api/billing/orders/:id/pay — 支付（v1 走 mock/易支付沙箱，回调后加权益）
    const payMatch = pathname.match(/^\/api\/billing\/orders\/([A-Za-z0-9-]+)\/pay$/);
    if (payMatch && method === "POST") {
      if (postgresBilling) {
        try { const result = await postgresBilling.payOrder(identity.sub, payMatch[1]); return sendJSON(res, 200, { success: true, ...result }); }
        catch (error) { return sendJSON(res, error.message.includes("不存在") ? 404 : 409, { error: error.message }); }
      }
      const order = billingOrders.find(o => o.id === payMatch[1] && o.userId === me.id);
      if (!order) return sendJSON(res, 404, { error: "订单不存在" });
      // 支付请求超时后再次点击属于同一个成功结果，直接返回成功，不能让前端误以为失败。
      if (order.status === "paid") {
        return sendJSON(res, 200, { success: true, order, user: publicUser(me), alreadyPaid: true });
      }
      if (order.status !== "pending") return sendJSON(res, 409, { error: "此订单已关闭，不能继续付款" });
      // v1：mock 支付直接成功；接真实微信/支付宝时在此对接，异步回调里调 completeOrder
      order.status = "paid";
      order.paidAt = Date.now();
      order.paymentMethod = order.paymentMethod || "mock";
      saveJSON(ORDERS_FILE, billingOrders);
      // 发权益
      const plan = billingPlans.find(p => p.id === order.planId);
      if (plan) issueMembership(me.id, plan);
      // 邀请奖励
      if (me.invitedBy && billingSettings.inviteRewardQuota > 0) {
        adjustBalance(me.invitedBy, billingSettings.inviteRewardQuota, "invite", order.id, `邀请${me.email || me.id}充值奖励`);
      }
      const refreshed = findUserByAppwriteId(me.id);
      return sendJSON(res, 200, { success: true, order, user: publicUser(refreshed) });
    }

    // POST /api/billing/redeem — 兑换码 { code }
    if (pathname === "/api/billing/redeem" && method === "POST") {
      const body = await parseBody(req);
      const code = (body.code || "").trim().toUpperCase();
      if (!code) return sendJSON(res, 400, { error: "请输入兑换码" });
      const record = billingCodes.find(c => c.code === code);
      if (!record) return sendJSON(res, 400, { error: "兑换码无效" });
      if (record.usedBy) return sendJSON(res, 400, { error: "兑换码已被使用" });
      if (record.expiredAt && Date.now() > record.expiredAt) return sendJSON(res, 400, { error: "兑换码已过期" });
      record.usedBy = me.id;
      record.usedAt = Date.now();
      saveJSON(CODES_FILE, billingCodes);
      if (record.kind === "membership" && record.planId) {
        const plan = billingPlans.find(p => p.id === record.planId);
        if (plan) issueMembership(me.id, plan);
      } else {
        adjustBalance(me.id, record.denomination, "redeem", "", "兑换码充值");
      }
      const refreshed = findUserByAppwriteId(me.id);
      return sendJSON(res, 200, { success: true, user: publicUser(refreshed) });
    }

    // GET /api/billing/orders — 我的订单
    if (pathname === "/api/billing/orders" && method === "GET") {
      if (postgresBilling) return sendJSON(res, 200, await postgresBilling.listOrders(identity.sub));
      const list = billingOrders.filter(o => o.userId === me.id)
        .sort((a, b) => b.createdAt - a.createdAt);
      return sendJSON(res, 200, list);
    }

    // GET /api/billing/transactions — 我的流水
    if (pathname === "/api/billing/transactions" && method === "GET") {
      if (postgresBilling) return sendJSON(res, 200, await postgresBilling.listTransactions(identity.sub));
      const list = billingTxs.filter(t => t.userId === me.id)
        .sort((a, b) => b.createdAt - a.createdAt);
      return sendJSON(res, 200, list.slice(0, 200));
    }

    // GET /api/billing/invite — 我的邀请
    if (pathname === "/api/billing/invite" && method === "GET") {
      const invited = billingUsers.filter(u => u.invitedBy === me.id);
      return sendJSON(res, 200, {
        inviteCode: me.inviteCode,
        invitedCount: invited.length,
        invitedList: invited.map(u => ({ email: u.email, totalSpent: u.totalSpent, createdAt: u.createdAt })),
        rewardQuota: billingSettings.inviteRewardQuota,
      });
    }

    return false;
  }

  // ---------- 管理端：/api/admin/billing/* ----------
  if (pathname.startsWith("/api/admin/billing/")) {
    // 管理端必须是管理员身份
    const adminIdentity = getBillingIdentity(req);
    if (!adminIdentity || adminIdentity.role !== "admin") {
      return sendJSON(res, 403, { error: "无管理员权限" });
    }

    // 管理端统计
    if (pathname === "/api/admin/billing/stats" && method === "GET") {
      const now = Date.now();
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const paidOrders = billingOrders.filter(o => o.status === "paid");
      const revenue = paidOrders.reduce((s, o) => s + o.amountCents, 0);
      const todayRevenue = paidOrders.filter(o => o.paidAt >= today.getTime()).reduce((s, o) => s + o.amountCents, 0);
      const activeMembers = billingUsers.filter(u => u.memberExpireAt > now).length;
      return sendJSON(res, 200, {
        userCount: billingUsers.length,
        activeMemberCount: activeMembers,
        orderCount: billingOrders.length,
        paidOrderCount: paidOrders.length,
        revenueCents: revenue,
        todayRevenueCents: todayRevenue,
        totalBalance: billingUsers.reduce((s, u) => s + (u.balance || 0), 0),
        unusedCodes: billingCodes.filter(c => !c.usedBy).length,
      });
    }

    // GET /api/admin/billing/users
    if (pathname === "/api/admin/billing/users" && method === "GET") {
      return sendJSON(res, 200, billingUsers.map(publicUser));
    }

    // POST /api/admin/billing/users/:id/adjust { delta, note }
    const adjMatch = pathname.match(/^\/api\/admin\/billing\/users\/([^/]+)\/adjust$/);
    if (adjMatch && method === "POST") {
      const body = await parseBody(req);
      const delta = Number(body.delta || 0);
      if (!delta) return sendJSON(res, 400, { error: "调整额度不能为空" });
      const u = adjustBalance(adjMatch[1], delta, "admin", "", body.note || "后台调整");
      if (!u) return sendJSON(res, 404, { error: "用户不存在" });
      return sendJSON(res, 200, publicUser(u));
    }

    // GET /api/admin/billing/orders
    if (pathname === "/api/admin/billing/orders" && method === "GET") {
      return sendJSON(res, 200, billingOrders.slice().sort((a, b) => b.createdAt - a.createdAt));
    }

    // POST /api/admin/billing/orders/:id/complete — 管理员手动标记订单已付
    const completeMatch = pathname.match(/^\/api\/admin\/billing\/orders\/([A-Za-z0-9]+)\/complete$/);
    if (completeMatch && method === "POST") {
      const order = billingOrders.find(o => o.id === completeMatch[1]);
      if (!order) return sendJSON(res, 404, { error: "订单不存在" });
      if (order.status !== "paid") {
        order.status = "paid";
        order.paidAt = Date.now();
        saveJSON(ORDERS_FILE, billingOrders);
        const plan = billingPlans.find(p => p.id === order.planId);
        if (plan) issueMembership(order.userId, plan);
      }
      return sendJSON(res, 200, order);
    }

    // GET /api/admin/billing/codes
    if (pathname === "/api/admin/billing/codes" && method === "GET") {
      return sendJSON(res, 200, billingCodes.slice().sort((a, b) => b.createdAt - a.createdAt));
    }

    // POST /api/admin/billing/codes — 批量生成 { count, denomination, kind, planId, days }
    if (pathname === "/api/admin/billing/codes" && method === "POST") {
      const body = await parseBody(req);
      const count = Math.min(Math.max(1, Number(body.count || 1)), 1000);
      const kind = body.kind === "membership" ? "membership" : "quota";
      const batch = "B" + Date.now().toString(36);
      const newCodes = [];
      for (let i = 0; i < count; i++) {
        const record = {
          code: genRedeemCode(),
          kind,
          denomination: kind === "membership" ? 0 : Number(body.denomination || 100),
          planId: kind === "membership" ? (body.planId || "pro") : "",
          usedBy: "", usedAt: 0,
          batch,
          createdAt: Date.now(),
          expiredAt: body.days ? Date.now() + Number(body.days) * 86400000 : 0,
        };
        billingCodes.push(record);
        newCodes.push(record.code);
      }
      saveJSON(CODES_FILE, billingCodes);
      return sendJSON(res, 200, { count: newCodes.length, batch, codes: newCodes });
    }

    // GET/PUT /api/admin/billing/plans
    if (pathname === "/api/admin/billing/plans" && method === "GET") {
      return sendJSON(res, 200, billingPlans);
    }
    if (pathname === "/api/admin/billing/plans" && method === "PUT") {
      const body = await parseBody(req);
      const idx = billingPlans.findIndex(p => p.id === body.id);
      if (idx === -1) return sendJSON(res, 404, { error: "套餐不存在" });
      Object.assign(billingPlans[idx], body);
      saveJSON(PLANS_FILE, billingPlans);
      return sendJSON(res, 200, billingPlans[idx]);
    }

    // GET /api/admin/billing/settings
    if (pathname === "/api/admin/billing/settings" && method === "GET") {
      return sendJSON(res, 200, billingSettings);
    }
    // PUT /api/admin/billing/settings
    if (pathname === "/api/admin/billing/settings" && method === "PUT") {
      const body = await parseBody(req);
      Object.assign(billingSettings, body);
      saveJSON(SETTINGS_FILE, billingSettings);
      return sendJSON(res, 200, billingSettings);
    }

    return false;
  }

  return false;
}

// 对外暴露的用户视图（脱敏）
function publicUser(u) {
  if (!u) return null;
  const now = Date.now();
  return {
    id: u.id,
    email: u.email,
    balance: u.balance || 0,
    memberLevel: u.memberLevel || "free",
    memberExpireAt: u.memberExpireAt || 0,
    memberActive: (u.memberExpireAt || 0) > now,
    inviteCode: u.inviteCode,
    totalSpent: u.totalSpent || 0,
    createdAt: u.createdAt,
  };
}

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  // CORS 预检
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    // ===== 公开接口（无需认证）=====

    // GET /api/config/public — 公开模型配置
    if (pathname === "/api/config/public" && req.method === "GET") {
      const publicKeys = keys
        .filter(k => k.is_active === 1)
        .map(k => ({
          id: k.id,
          name: k.name,
          base_url: k.base_url,
          provider: k.provider,
          model: k.model,
        }));
      return sendJSON(res, 200, publicKeys);
    }

    // POST /api/proxy/openai/* — AI 请求代理
    if (pathname.startsWith("/api/proxy/openai/") && req.method === "POST") {
      const targetPath = pathname.replace("/api/proxy/openai", "");
      return proxyRequest(req, res, targetPath);
    }

    // POST /api/admin/login — 管理员登录
    if (pathname === "/api/admin/login" && req.method === "POST") {
      const body = await parseBody(req);
      if (body.username === admin.username && hashPassword(body.password || "") === admin.password) {
        const exp = Math.floor(Date.now() / 1000) + 24 * 60 * 60; // 24h
        const token = signJWT({ sub: admin.username, role: "admin", iat: Math.floor(Date.now() / 1000), exp });
        return sendJSON(res, 200, { token });
      }
      return sendJSON(res, 401, { error: "用户名或密码错误" });
    }

    // ===== 计费系统路由（客户 + 管理端计费）=====
    if (await handleBilling(req, res, pathname, req.method, url)) {
      return;
    }

    // ===== 管理接口（需管理员认证；客户 token 一律拒绝）=====
    if (pathname.startsWith("/api/admin/") && pathname !== "/api/admin/login") {
      const auth = req.headers["authorization"] || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
      const payload = token ? verifyJWT(token) : null;
      if (!payload) {
        return sendJSON(res, 401, { error: "未登录或登录已过期" });
      }
      if (payload.role && payload.role !== "admin") {
        return sendJSON(res, 403, { error: "无管理员权限" });
      }
    }

    // GET /api/admin/api-keys — 密钥列表（脱敏）
    if (pathname === "/api/admin/api-keys" && req.method === "GET") {
      const list = keys.map(k => ({
        ...k,
        api_key_masked: maskKey(k.api_key),
      }));
      return sendJSON(res, 200, list);
    }

    // POST /api/admin/api-keys — 新增密钥
    if (pathname === "/api/admin/api-keys" && req.method === "POST") {
      const body = await parseBody(req);
      if (!body.name || !body.base_url || !body.api_key) {
        return sendJSON(res, 400, { error: "名称、API 地址、API Key 为必填项" });
      }
      const newKey = {
        id: nextId(),
        name: body.name,
        provider: body.provider || "openai",
        base_url: body.base_url,
        api_key: body.api_key,
        model: body.model || "",
        max_concurrency: body.max_concurrency ? Number(body.max_concurrency) : null,
        is_active: 1,
        created_at: Date.now(),
      };
      keys.push(newKey);
      saveJSON(KEYS_FILE, keys);
      return sendJSON(res, 200, { ...newKey, api_key_masked: maskKey(newKey.api_key) });
    }

    // PUT /api/admin/api-keys/:id — 更新密钥
    const putMatch = pathname.match(/^\/api\/admin\/api-keys\/(\d+)$/);
    if (putMatch && req.method === "PUT") {
      const id = parseInt(putMatch[1], 10);
      const idx = keys.findIndex(k => k.id === id);
      if (idx === -1) return sendJSON(res, 404, { error: "密钥不存在" });
      const body = await parseBody(req);
      // 只更新提供的字段
      if (body.name !== undefined) keys[idx].name = body.name;
      if (body.provider !== undefined) keys[idx].provider = body.provider;
      if (body.base_url !== undefined) keys[idx].base_url = body.base_url;
      if (body.api_key !== undefined && body.api_key) keys[idx].api_key = body.api_key;
      if (body.model !== undefined) keys[idx].model = body.model;
      if (body.max_concurrency !== undefined) keys[idx].max_concurrency = body.max_concurrency ? Number(body.max_concurrency) : null;
      if (body.is_active !== undefined) keys[idx].is_active = Number(body.is_active);
      saveJSON(KEYS_FILE, keys);
      return sendJSON(res, 200, { ...keys[idx], api_key_masked: maskKey(keys[idx].api_key) });
    }

    // DELETE /api/admin/api-keys/:id — 删除密钥
    const delMatch = pathname.match(/^\/api\/admin\/api-keys\/(\d+)$/);
    if (delMatch && req.method === "DELETE") {
      const id = parseInt(delMatch[1], 10);
      keys = keys.filter(k => k.id !== id);
      saveJSON(KEYS_FILE, keys);
      return sendJSON(res, 200, { success: true });
    }

    // GET /api/admin/api-keys/:id/full — 获取完整密钥（编辑时拉模型用）
    const fullMatch = pathname.match(/^\/api\/admin\/api-keys\/(\d+)\/full$/);
    if (fullMatch && req.method === "GET") {
      const id = parseInt(fullMatch[1], 10);
      const k = keys.find(k => k.id === id);
      if (!k) return sendJSON(res, 404, { error: "密钥不存在" });
      return sendJSON(res, 200, { api_key: k.api_key });
    }

    // POST /api/admin/fetch-models — 从供应商拉取模型列表
    if (pathname === "/api/admin/fetch-models" && req.method === "POST") {
      const body = await parseBody(req);
      if (!body.base_url || !body.api_key) {
        return sendJSON(res, 400, { error: "base_url 和 api_key 必填" });
      }
      try {
        const base = body.base_url.replace(/\/+$/, "");
        const modelsUrl = new URL(base + "/models");
        const isHttps = modelsUrl.protocol === "https:";
        const lib = isHttps ? https : http;
        const result = await new Promise((resolve, reject) => {
          const r = lib.get({
            hostname: modelsUrl.hostname,
            port: modelsUrl.port || (isHttps ? 443 : 80),
            path: modelsUrl.pathname + modelsUrl.search,
            headers: { "Authorization": `Bearer ${body.api_key}` },
            timeout: 15000,
          }, resp => {
            let d = "";
            resp.on("data", c => d += c);
            resp.on("end", () => resolve({ status: resp.statusCode, body: d }));
          });
          r.on("error", reject);
          r.on("timeout", () => { r.destroy(); reject(new Error("超时")); });
        });
        if (result.status !== 200) {
          return sendJSON(res, result.status, { error: "上游返回 " + result.status, data: [] });
        }
        const parsed = JSON.parse(result.body);
        const modelList = (parsed.data || []).map(m => ({ id: m.id }));
        return sendJSON(res, 200, { data: modelList });
      } catch (e) {
        return sendJSON(res, 502, { error: "拉取模型失败: " + e.message });
      }
    }

    // GET /api/admin/key-stats — 密钥使用统计（占位，返回空结构）
    if (pathname === "/api/admin/key-stats" && req.method === "GET") {
      const stats = {};
      keys.forEach(k => { stats[k.id] = { success: 0, failure: 0, total: 0 }; });
      return sendJSON(res, 200, stats);
    }

    // GET /api/admin/key-history — 密钥使用历史（占位）
    if (pathname === "/api/admin/key-history" && req.method === "GET") {
      const history = {};
      keys.forEach(k => { history[k.id] = []; });
      return sendJSON(res, 200, history);
    }

    // POST /api/admin/change-password — 修改密码
    if (pathname === "/api/admin/change-password" && req.method === "POST") {
      const body = await parseBody(req);
      if (hashPassword(body.oldPassword || "") !== admin.password) {
        return sendJSON(res, 400, { error: "原密码错误" });
      }
      if (!body.newPassword || body.newPassword.length < 6) {
        return sendJSON(res, 400, { error: "新密码至少 6 位" });
      }
      if (body.newPassword !== body.confirmPassword) {
        return sendJSON(res, 400, { error: "两次输入的新密码不一致" });
      }
      admin.password = hashPassword(body.newPassword);
      saveJSON(ADMIN_FILE, admin);
      return sendJSON(res, 200, { success: true });
    }

    // 404
    return sendJSON(res, 404, { error: "接口不存在: " + pathname });

  } catch (err) {
    console.error("[server error]", err);
    if (!res.headersSent) sendJSON(res, 500, { error: "服务器内部错误: " + err.message });
  }
});

server.listen(PORT, () => {
  console.log(`[qingyu-api] 服务已启动，端口 ${PORT}`);
  console.log(`[qingyu-api] 数据目录: ${DATA_DIR}`);
  console.log(`[qingyu-api] 活跃密钥: ${keys.filter(k => k.is_active === 1).length} 个`);
});
