/**
 * 轻域AI API 后端服务
 * 功能：API 密钥管理、公开模型配置、AI 请求代理（服务端注入密钥）
 * 零依赖，仅用 Node.js 内置模块
 * 端口：3001
 */
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { PassThrough, Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { buildAssetObjectKey, isAssetPreviewVariant, validateUploadSessionSize, writeAssetUpload } from './asset-upload.mjs';
import { createObjectStore, sniffImageMime, DEFAULT_MAX_UPLOAD_BYTES } from './object-store.mjs';
import { createAdminPasswordHash, needsAdminPasswordRehash, verifyAdminPassword } from './admin-password.mjs';

const DEFAULT_JWT_SECRET = "qingyu-api-jwt-secret-2026-change-me";
const configuredJwtSecret = String(process.env.JWT_SECRET || "").trim();
if (process.env.NODE_ENV === "production" && (!configuredJwtSecret || configuredJwtSecret === DEFAULT_JWT_SECRET)) {
  console.error("[security] 生产环境必须配置非默认的 JWT_SECRET，API 服务拒绝启动。");
  process.exit(1);
}
const JWT_SECRET = configuredJwtSecret || DEFAULT_JWT_SECRET;

const APPWRITE_INTERNAL_URL = process.env.APPWRITE_INTERNAL_URL || "http://127.0.0.1:8081/v1";
if (process.env.NODE_ENV !== "production") {
  const endpoint = new URL(APPWRITE_INTERNAL_URL);
  if (!["http:", "https:"].includes(endpoint.protocol)
    || !["localhost", "127.0.0.1", "[::1]", "appwrite", "host.docker.internal"].includes(endpoint.hostname)
    || endpoint.username || endpoint.password) {
    throw new Error("APPWRITE_INTERNAL_URL 只允许本机或本地容器，本地开发禁止连接远程身份服务");
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "api-data");
const LEGACY_OBJECT_DATA_DIR = process.env.OBJECT_DATA_DIR || path.join(DATA_DIR, "objects");
const objectStore = createObjectStore();
const KEYS_FILE = path.join(DATA_DIR, "keys.json");
const ADMIN_FILE = path.join(DATA_DIR, "admin.json");
// ===== 计费系统数据文件 =====
const USERS_FILE = path.join(DATA_DIR, "billing_users.json");       // 客户计费账本（按 Appwrite 用户 ID）
const ORDERS_FILE = path.join(DATA_DIR, "billing_orders.json");     // 订单
const CODES_FILE = path.join(DATA_DIR, "billing_codes.json");       // 兑换码
const TX_FILE = path.join(DATA_DIR, "billing_transactions.json");   // 流水
const PLANS_FILE = path.join(DATA_DIR, "billing_plans.json");       // 会员套餐
const SETTINGS_FILE = path.join(DATA_DIR, "billing_settings.json"); // 系统设置（支付开关等）
const MODELS_CATALOG_FILE = path.join(DATA_DIR, "models_catalog.json"); // 模型目录
const PORT = process.env.PORT || 3001;
// 生产固定仅本机可达；本地容器显式放开容器内监听，由 Docker 限制宿主机端口。
const API_HOST = process.env.NODE_ENV === "production" ? "127.0.0.1" : (process.env.API_HOST || "127.0.0.1");
// 只有隔离测试环境显式设置 PAYMENT_MODE=mock 才允许模拟支付；生产默认关闭。
const PAYMENT_MODE = String(process.env.PAYMENT_MODE || '').trim().toLowerCase();
const CUSTOMER_SESSION_COOKIE = "qingyu_session";
const CUSTOMER_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const CONFIGURED_CORS_ORIGINS = new Set(String(process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",").map(origin => origin.trim()).filter(Boolean));
if (process.env.NODE_ENV !== "production") {
  CONFIGURED_CORS_ORIGINS.add("http://localhost:5173");
  CONFIGURED_CORS_ORIGINS.add("http://127.0.0.1:5173");
}
let postgresBilling = null;
const catalogModelRouteOffsets = new Map();

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
  admin = { username: "admin", password: await hashPassword("QingyuAdmin2026!") };
  saveJSON(ADMIN_FILE, admin);
  console.log("[init] 管理员已初始化，用户名: admin，密码: QingyuAdmin2026!（请尽快修改）");
}

// API 密钥列表
let keys = loadJSON(KEYS_FILE, []);

// 用 Appwrite 短期 JWT 反查当前登录身份，不能相信浏览器单独提交的 userId。
async function verifyAppwriteUser(appwriteJwt) {
  const token = String(appwriteJwt || "").trim();
  if (!token) return null;
  let endpoint;
  try { endpoint = new URL(`${APPWRITE_INTERNAL_URL.replace(/\/$/, "")}/account`); } catch { return null; }
  const transport = endpoint.protocol === "https:" ? https : http;
  return await new Promise(resolve => {
    const request = transport.request(endpoint, {
      method: "GET",
      headers: { "X-Appwrite-Project": "qingyu", "X-Appwrite-JWT": token, "X-Forwarded-Proto": "https", Accept: "application/json" },
      timeout: 8000,
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        if (response.statusCode !== 200) return resolve(null);
        try {
          const user = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          resolve(user && typeof user.$id === "string" ? user : null);
        } catch { resolve(null); }
      });
    });
    request.on("error", () => resolve(null));
    request.on("timeout", () => request.destroy());
    request.end();
  });
}

// ===================== 计费系统：数据加载与种子 =====================
let billingUsers = loadJSON(USERS_FILE, []);       // 客户账本数组
let billingOrders = loadJSON(ORDERS_FILE, []);     // 订单数组
let billingCodes = loadJSON(CODES_FILE, []);       // 兑换码数组
let billingTxs = loadJSON(TX_FILE, []);            // 流水数组
let billingPlans = loadJSON(PLANS_FILE, []);      // 套餐数组
let billingSettings = loadJSON(SETTINGS_FILE, null); // 设置
let modelsCatalog = loadJSON(MODELS_CATALOG_FILE, []);       // 模型目录数组

if (process.env.BILLING_STORE === "postgres") {
  const { createPostgresBillingStore } = await import("./postgres-billing-store.mjs");
  postgresBilling = await createPostgresBillingStore();
  // 管理员凭据进入 PostgreSQL；首次迁移时只复制哈希，不再把密码当作业务数据写入前端。
  await postgresBilling.ensureAdminAccount(admin.username, admin.password);
  // PostgreSQL 是正式来源；首次切换时把旧 keys.json 迁入数据库，避免已有渠道丢失。
  const storedApiKeys = await postgresBilling.listPlatformApiKeys();
  if (storedApiKeys.length === 0 && keys.length > 0) {
    for (const legacyKey of keys) await postgresBilling.createPlatformApiKey(legacyKey);
  }
  keys = await postgresBilling.listPlatformApiKeys();
  const storedBillingSettings = await postgresBilling.getSystemSetting("billing", null);
  if (storedBillingSettings && typeof storedBillingSettings === "object") billingSettings = storedBillingSettings;
  else await postgresBilling.setSystemSetting("billing", billingSettings);
  console.log("[billing] PostgreSQL 计费存储已启用");
}

// 默认套餐（首次启动写入）
const DEFAULT_PLANS = [
  { id: "free",   name: "免费版", priceCents: 0,      durationDays: 0,   monthlyQuota: 0,     level: "free",
    description: "注册一次赠送50积分，用完需订阅", features: ["一次性赠送50积分", "积分用完后需订阅"] },
  { id: "pro",    name: "Pro",    priceCents: 2900,   durationDays: 30,  monthlyQuota: 50000, level: "pro",
    description: "个人创作者首选", features: ["每月 5 万积分", "全部模型", "50 个画布", "优先响应"] },
  { id: "team",   name: "团队版", priceCents: 9900,   durationDays: 30,  monthlyQuota: 300000, level: "team",
    description: "多人协作", features: ["每月 30 万积分", "无限画布", "团队协作", "专属支持"] },
];

if (!billingSettings) {
  billingSettings = {
    currency: "CNY",
    payEnabled: { mock: PAYMENT_MODE === 'mock', epay: false, wechat: false, alipay: false },
    inviteRewardCents: 0,          // 邀请人奖励（分），0 关闭
    inviteRewardQuota: 500,        // 邀请人奖励积分
    registeredBonusQuota: 100,     // 新注册赠送积分
    supplier: {
      maizitech: {
        enabled: false,
        baseUrl: "https://www.maizitech.ai",
        apiKey: "",
        balanceToken: "",
      },
    },
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
  // 使用日历月/年续期并记录原始日，月底不足时临时取月末，下一期仍沿用原始日期。
  const base = u.memberExpireAt > now ? u.memberExpireAt : now;
  const anchorMonth = u.memberExpireAt > now ? (u.memberBillingAnchorMonth || new Date(base).getUTCMonth() + 1) : new Date(now).getUTCMonth() + 1;
  const anchorDay = u.memberExpireAt > now ? (u.memberBillingAnchorDay || new Date(base).getUTCDate()) : new Date(now).getUTCDate();
  const isYearly = plan.durationDays >= 360;
  const source = new Date(base);
  const year = source.getUTCFullYear() + (isYearly ? 1 : 0);
  const month = isYearly ? anchorMonth - 1 : source.getUTCMonth() + 1;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const day = Math.min(anchorDay, new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate());
  u.memberLevel = plan.level;
  u.memberExpireAt = Date.UTC(targetYear, targetMonth, day, source.getUTCHours(), source.getUTCMinutes(), source.getUTCSeconds(), source.getUTCMilliseconds());
  u.memberBillingAnchorMonth = anchorMonth;
  u.memberBillingAnchorDay = anchorDay;
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
function readCookie(req, name) {
  const cookieHeader = String(req.headers.cookie || "");
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    return item.slice(separator + 1).trim();
  }
  return "";
}

function customerSessionCookie(token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${CUSTOMER_SESSION_COOKIE}=${token}; Path=/api; Max-Age=${CUSTOMER_SESSION_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure}`;
}

function clearCustomerSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${CUSTOMER_SESSION_COOKIE}=; Path=/api; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}

function isAllowedBrowserOrigin(origin, req) {
  if (!origin) return false;
  if (CONFIGURED_CORS_ORIGINS.has(origin)) return true;
  const host = String(req.headers.host || "").trim();
  if (!host) return false;
  const allowedProtocol = process.env.NODE_ENV === "production" ? "https:" : null;
  try {
    const parsed = new URL(origin);
    return parsed.host === host && (!allowedProtocol || parsed.protocol === allowedProtocol);
  } catch {
    return false;
  }
}

function requestCorsHeaders(req) {
  const origin = String(req.headers.origin || "");
  if (origin && isAllowedBrowserOrigin(origin, req)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Vary": "Origin",
    };
  }
  // 白名单外的 Origin 不返回任何 CORS 头，浏览器会直接拦截跨域读取。
  // 同源请求与 curl/服务端调用不检查 CORS，不受影响。
  return {};
}

function applyCors(req, res) {
  for (const [name, value] of Object.entries(requestCorsHeaders(req))) res.setHeader(name, value);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Qingyu-Requested-With");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
}

function isUnsafeMethod(method) {
  return !["GET", "HEAD", "OPTIONS"].includes(String(method || "").toUpperCase());
}

function hasTrustedMutationOrigin(req) {
  return isAllowedBrowserOrigin(String(req.headers.origin || ""), req);
}

// 管理员仍使用 Authorization；普通用户只能通过 HttpOnly Cookie 鉴权。
function getBillingIdentity(req) {
  const auth = req.headers["authorization"] || "";
  const bearerToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const bearerIdentity = bearerToken ? verifyJWT(bearerToken) : null;
  if (bearerIdentity?.role === "admin") return bearerIdentity;
  const cookieToken = readCookie(req, CUSTOMER_SESSION_COOKIE);
  const cookieIdentity = cookieToken ? verifyJWT(cookieToken) : null;
  if (cookieIdentity?.role !== "customer" || typeof cookieIdentity.sid !== "string" || !cookieIdentity.sid) return null;
  return cookieIdentity; // { sub, role, sid, exp }
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
  return createAdminPasswordHash(pw);
}

// 本地文件模式按账号限速；生产 PostgreSQL 模式使用持久化的数据库限速记录。
const adminLoginAttempts = new Map();
function reserveAdminLoginAttempt(username, now = Date.now()) {
  const key = crypto.createHash("sha256").update(username.trim().toLowerCase()).digest("hex");
  for (const [savedKey, attempt] of adminLoginAttempts) {
    if (attempt.expiresAt <= now) adminLoginAttempts.delete(savedKey);
  }
  let attempt = adminLoginAttempts.get(key);
  // 限制内存占用；容量满时不淘汰已有账号，避免攻击者挤掉限速记录。
  if (!attempt && adminLoginAttempts.size >= 4096) return { retryAfter: 60 };
  if (!attempt) {
    attempt = { count: 0, expiresAt: now + 15 * 60 * 1000 };
    adminLoginAttempts.set(key, attempt);
  }
  if (attempt.count >= 10) return { retryAfter: Math.max(1, Math.ceil((attempt.expiresAt - now) / 1000)) };
  attempt.count += 1; // 在异步查询之前占位，并发请求不能越过次数限制。
  return { key, retryAfter: 0 };
}

function maskKey(key) {
  if (!key || key.length <= 8) return "****";
  return key.slice(0, 4) + "..." + key.slice(-4);
}

function publicApiKey(key) {
  const { api_key, ...safe } = key;
  return { ...safe, api_key_masked: key.api_key_masked || maskKey(api_key) };
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

function parseRawBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > maxBytes) { reject(new Error('请求体过大')); req.destroy(); return; } chunks.push(chunk); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJSON(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  const corsHeaders = {
    ...(res.getHeader("Access-Control-Allow-Origin") ? { "Access-Control-Allow-Origin": res.getHeader("Access-Control-Allow-Origin") } : {}),
    "Access-Control-Allow-Headers": res.getHeader("Access-Control-Allow-Headers") || "Content-Type, Authorization, X-Qingyu-Requested-With",
    "Access-Control-Allow-Methods": res.getHeader("Access-Control-Allow-Methods") || "GET, POST, PUT, DELETE, OPTIONS",
  };
  const allowCredentials = res.getHeader("Access-Control-Allow-Credentials");
  const vary = res.getHeader("Vary");
  if (allowCredentials) corsHeaders["Access-Control-Allow-Credentials"] = allowCredentials;
  if (vary) corsHeaders.Vary = vary;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders,
    ...headers,
  });
  res.end(body);
  return true;
}

function nextId() {
  return keys.length > 0 ? Math.max(...keys.map(k => k.id)) + 1 : 1;
}

// 根据模型名找到对应渠道（模型名格式: channelId::modelName 或纯 modelName）
function findChannel(modelName) {
  if (!modelName) return null;
  // 优先解析 channelId::modelName 格式（channelId 可能是数字或 UUID）
  const sepIdx = modelName.indexOf("::");
  if (sepIdx > 0) {
    const cid = modelName.slice(0, sepIdx);
    const pureModel = modelName.slice(sepIdx + 2);
    const ch = keys.find(k => String(k.id) === cid && k.is_active === 1);
    if (ch) return { channel: ch, model: pureModel };
    // channelId 匹配失败时，用纯模型名继续走后面的回退逻辑
    modelName = pureModel;
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

async function findChannelForModel(modelName) {
  const requestedModel = String(modelName || '');
  const separatorIndex = requestedModel.indexOf('::');
  const logicalModel = separatorIndex > 0 ? requestedModel.slice(separatorIndex + 2) : requestedModel;
  const catalogMatch = logicalModel.match(/^catalog:(\d+)$/);
  if (!catalogMatch) return findChannel(modelName);
  const catalogModelId = Number(catalogMatch[1]);
  const routes = postgresBilling
    ? await postgresBilling.listPlatformModelRoutes(catalogModelId)
    : (modelsCatalog.find(model => Number(model.id) === catalogModelId)?.linkedModels || [])
      .filter(link => link.isActive !== false)
      .map(link => ({ channel: keys.find(key => String(key.id) === String(link.channelId) && key.is_active === 1), model: link.model, priority: link.priority || 0 }))
      .filter(route => route.channel)
      .sort((a, b) => a.priority - b.priority);
  if (!routes.length) return null;
  const offset = catalogModelRouteOffsets.get(catalogModelId) || 0;
  catalogModelRouteOffsets.set(catalogModelId, (offset + 1) % routes.length);
  return { ...routes[offset % routes.length], catalogModelId };
}

// ---------- AI 请求代理 ----------
function proxyRequest(req, res, targetPath) {
  let bodyChunks = [];
  req.on("data", chunk => bodyChunks.push(chunk));
  req.on("end", async () => {
    // 代理调用必须绑定业务会话，不能只凭浏览器提交的模型名或上游 API Key 消耗供应商资源。
    // 普通用户身份来自 HttpOnly Cookie；Authorization 保留给模型供应商密钥。
    const proxyToken = readCookie(req, CUSTOMER_SESSION_COOKIE);
    const proxyIdentity = proxyToken ? verifyJWT(proxyToken) : null;
    if (!proxyIdentity || proxyIdentity.role !== "customer" || !proxyIdentity.sid) {
      return sendJSON(res, 401, { error: "请先登录后再使用 AI 服务" });
    }
    // 先确认 PostgreSQL 可用，再严格核对设备会话；旧版无 sid 的 JWT 已在上方拒绝。
    if (!postgresBilling) {
      return sendJSON(res, 503, { error: "计费服务未启用，AI 调用暂不可用" });
    }
    if (!(await postgresBilling.isSessionActive(proxyIdentity.sub, proxyIdentity.sid))) {
      return sendJSON(res, 401, { error: "当前登录设备已离线，请重新登录后再使用 AI 服务" });
    }
    const rawBody = Buffer.concat(bodyChunks).toString("utf-8");
    let bodyObj = {};
    try { bodyObj = rawBody ? JSON.parse(rawBody) : {}; } catch { bodyObj = {}; }

    const modelField = bodyObj.model || "";
    const match = await findChannelForModel(modelField);
    if (!match) {
      return sendJSON(res, 502, { error: "没有可用的 API 渠道，请先在管理后台添加并启用 API Key" });
    }
    const { channel, model } = match;
    if (!match.catalogModelId) return sendJSON(res, 402, { error: "该模型不属于平台积分计费目录，不能使用平台积分生成" });

    // 替换模型名为纯模型名（去掉 channelId 前缀）
    if (modelField.includes("::") || match.catalogModelId) {
      bodyObj.model = model;
    }
    const forwardBody = JSON.stringify(bodyObj);

    const proxyRequestId = String(req.headers["x-request-id"] || crypto.randomUUID()).slice(0, 160);
    const usageKey = `proxy:${proxyRequestId}`;
    const requestedQuantity = Math.max(1, Math.min(15, Number(bodyObj.n) || 1));
    const requestHash = crypto.createHash("sha256").update(JSON.stringify({ targetPath, modelField, bodyObj })).digest("hex");
    if (postgresBilling) {
      try {
        await postgresBilling.recordProviderUsage(proxyIdentity.sub, {
          requestId: proxyRequestId,
          idempotencyKey: usageKey,
          quantity: requestedQuantity,
          provider: channel.provider,
          model,
          catalogModelId: match.catalogModelId,
          requestHash,
          metadata: { targetPath, channelId: channel.id, phase: "started", catalogModelId: match.catalogModelId, requestedModel: modelField, requestHash, prompt: String(bodyObj.prompt || bodyObj.input || '').slice(0, 4000), duration: Number(bodyObj.duration || bodyObj.seconds || 0) },
        });
      } catch (error) {
        console.error("[proxy usage] unable to persist request", error.message);
        if (/同一代理请求编号/.test(String(error.message || ""))) return sendJSON(res, 409, { error: error.message });
        if (/积分|额度|余额|quota|insufficient|daily/i.test(String(error.message || ""))) {
          return sendJSON(res, 402, { error: error.message || "积分不足，请订阅后继续使用" });
        }
        return sendJSON(res, 503, { error: "当前服务无法记录本次请求，请稍后重试" });
      }
    }

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
      res.writeHead(proxyRes.statusCode || 502, respHeaders);
      // 图片接口：先缓冲响应体，检查上游真的返回了图片再记成功，
      // 避免上游返回 200 但 body 是空 data/错误 JSON 时被误记为成功扣费。
      const isImagePath = /\/images\//i.test(targetPath);
      if (isImagePath) {
        const chunks = [];
        proxyRes.on("data", chunk => chunks.push(chunk));
        proxyRes.on("end", () => {
          const buf = Buffer.concat(chunks);
          res.end(buf);
          if (!postgresBilling) return;
          const httpStatus = proxyRes.statusCode || 502;
          let billingResult = "committed";
          let extraMeta = { targetPath, statusCode: httpStatus, phase: "finished" };
          if (httpStatus >= 200 && httpStatus < 300) {
            try {
              const parsed = JSON.parse(buf.toString("utf-8"));
              const arr = Array.isArray(parsed.data) ? parsed.data : [];
              const hasImage = arr.some(item => item && (item.b64_json || item.url || item.task_id));
              if (!hasImage) {
                billingResult = "failed";
                extraMeta = { ...extraMeta, phase: "empty_image", error: "上游 200 但未返回图片数据" };
              }
            } catch (parseErr) {
              billingResult = "failed";
              extraMeta = { ...extraMeta, phase: "bad_json", error: String(parseErr.message || parseErr).slice(0, 200) };
            }
          } else {
            billingResult = "failed";
          }
          void postgresBilling.completeProviderUsage(proxyIdentity.sub, usageKey, billingResult, extraMeta)
            .catch(error => console.error("[proxy usage] finalize failed", error.message));
        });
        return;
      }

      proxyRes.pipe(res);
      proxyRes.on("end", () => {
        if (postgresBilling) {
          const result = proxyRes.statusCode >= 200 && proxyRes.statusCode < 300 ? "committed" : "failed";
          void postgresBilling.completeProviderUsage(proxyIdentity.sub, usageKey, result, { targetPath, statusCode: proxyRes.statusCode || 502, phase: "finished" }).catch(error => console.error("[proxy usage] finalize failed", error.message));
        }
      });

    });
    proxyReq.on("error", err => {
      console.error("[proxy error]", err.message);
      if (postgresBilling) void postgresBilling.completeProviderUsage(proxyIdentity.sub, usageKey, "unknown", { targetPath, error: err.message, phase: "error" }).catch(error => console.error("[proxy usage] finalize failed", error.message));
      if (!res.headersSent) {
        sendJSON(res, 502, { error: "代理请求失败: " + err.message });
      }
    });

    proxyReq.on("timeout", () => {
      proxyReq.destroy();
      if (postgresBilling) void postgresBilling.completeProviderUsage(proxyIdentity.sub, usageKey, "unknown", { targetPath, phase: "timeout" }).catch(error => console.error("[proxy usage] finalize failed", error.message));
      if (!res.headersSent) sendJSON(res, 504, { error: "生成超时，请重试" });
    });

    proxyReq.write(forwardBody);
    proxyReq.end();
  });
}

// ---------- 异步生图任务 worker（0046）：后台调用上游，状态机 pending→running→succeeded/refunded ----------
function buildUpstreamImageUrl(baseUrl) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  if (!base) throw new Error("渠道未配置 base_url");
  // 渠道地址可能已经包含 /v1；统一只保留一段，避免请求 /v1/v1/...
  return new URL(/\/v1$/i.test(base) ? `${base}/images/generations` : `${base}/v1/images/generations`);
}

function buildUpstreamImageEditUrl(baseUrl) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  if (!base) throw new Error("渠道未配置 base_url");
  return new URL(/\/v1$/i.test(base) ? `${base}/images/edits` : `${base}/v1/images/edits`);
}

async function callUpstreamImage(channel, bodyObj, onBase64Output, referenceFiles = []) {
  if (referenceFiles.length) return callUpstreamImageEditStreaming(channel, bodyObj, referenceFiles, onBase64Output);
  return callUpstreamImageStreaming(channel, bodyObj, onBase64Output);
}

function createStreamingJsonReader(source, maxBytes) {
  const iterator = source[Symbol.asyncIterator]();
  const decoder = new StringDecoder('utf8');
  let text = '';
  let offset = 0;
  let totalBytes = 0;
  let ended = false;

  async function fill() {
    if (offset < text.length) return true;
    if (ended) return false;
    while (true) {
      const next = await iterator.next();
      if (next.done) {
        text = decoder.end();
        offset = 0;
        ended = true;
        return text.length > 0;
      }
      totalBytes += next.value.length;
      if (totalBytes > maxBytes) throw new Error('上游图片响应超过允许的大小限制');
      text = decoder.write(next.value);
      offset = 0;
      if (text.length) return true;
    }
  }

  async function peek() { return await fill() ? text[offset] : null; }
  async function next() { return await fill() ? text[offset++] : null; }
  async function expect(expected) {
    const actual = await next();
    if (actual !== expected) throw new Error('上游图片响应格式无效');
  }
  async function skipWhitespace() {
    while (/\s/.test(await peek() || '')) await next();
  }
  async function readEscape() {
    const escaped = await next();
    if (escaped === '"' || escaped === '\\' || escaped === '/') return escaped;
    if (escaped === 'b') return '\b';
    if (escaped === 'f') return '\f';
    if (escaped === 'n') return '\n';
    if (escaped === 'r') return '\r';
    if (escaped === 't') return '\t';
    if (escaped === 'u') {
      let hex = '';
      for (let i = 0; i < 4; i++) hex += await next() || '';
      if (!/^[0-9a-f]{4}$/i.test(hex)) throw new Error('上游图片响应包含无效转义');
      return String.fromCharCode(Number.parseInt(hex, 16));
    }
    throw new Error('上游图片响应包含无效转义');
  }
  async function readString(onChunk, maxCharacters = 1024 * 1024) {
    await expect('"');
    let characterCount = 0;
    let piece = '';
    const emit = async value => {
      characterCount += value.length;
      if (characterCount > maxCharacters) throw new Error('上游图片响应中的文字字段过长');
      piece += value;
      if (piece.length >= 64 * 1024) {
        if (onChunk) await onChunk(piece);
        piece = '';
      }
    };
    while (true) {
      await fill();
      if (offset >= text.length) throw new Error('上游图片响应中的字符串未结束');
      let special = text.length;
      for (const delimiter of ['"', '\\']) {
        const found = text.indexOf(delimiter, offset);
        if (found >= 0 && found < special) special = found;
      }
      for (let i = offset; i < special; i++) {
        if (text.charCodeAt(i) < 0x20) throw new Error('上游图片响应包含无效控制字符');
      }
      if (special > offset) {
        const value = text.slice(offset, special);
        offset = special;
        await emit(value);
        continue;
      }
      const delimiter = await next();
      if (delimiter === '"') break;
      if (delimiter !== '\\') throw new Error('上游图片响应格式无效');
      await emit(await readEscape());
    }
    if (piece) {
      if (onChunk) await onChunk(piece);
      else return piece;
    }
    if (!onChunk) return '';
    return undefined;
  }
  return { peek, next, expect, skipWhitespace, readString };
}

async function writeStreamChunk(stream, chunk) {
  if (!chunk.length || stream.destroyed) return;
  if (stream.write(chunk)) return;
  await new Promise((resolve, reject) => {
    const onDrain = () => { cleanup(); resolve(); };
    const onError = error => { cleanup(); reject(error); };
    const onClose = () => { cleanup(); reject(new Error('COS 图片上传流已关闭')); };
    const cleanup = () => {
      stream.off('drain', onDrain);
      stream.off('error', onError);
      stream.off('close', onClose);
    };
    stream.once('drain', onDrain);
    stream.once('error', onError);
    stream.once('close', onClose);
    if (stream.destroyed) onClose();
  });
}

async function readBase64StringToStream(reader, stream) {
  let encodedTail = '';
  let decodedBytes = 0;
  let sinkError = null;
  let paddingSeen = false;

  const consume = async chunk => {
    if (paddingSeen ? !/^={1,2}$/.test(chunk) : !/^[A-Za-z0-9+/]*={0,2}$/.test(chunk)) {
      throw new Error('上游返回的图片编码无效');
    }
    if (chunk.includes('=')) paddingSeen = true;
    encodedTail += chunk;

    const alignedLength = encodedTail.length - (encodedTail.length % 4);
    const paddingOffset = encodedTail.indexOf('=');
    const flushLength = paddingOffset < 0 ? alignedLength : Math.min(alignedLength, Math.floor(paddingOffset / 4) * 4);
    if (!flushLength) return;
    const encoded = encodedTail.slice(0, flushLength);
    if (!/^[A-Za-z0-9+/]+$/.test(encoded)) throw new Error('上游返回的图片编码无效');
    encodedTail = encodedTail.slice(flushLength);
    const decoded = Buffer.from(encoded, 'base64');
    decodedBytes += decoded.length;
    if (decodedBytes > DEFAULT_MAX_UPLOAD_BYTES) throw new Error('生成图片超过允许的大小限制');
    if (!sinkError) {
      try { await writeStreamChunk(stream, decoded); }
      catch (error) { sinkError = error; }
    }
  };

  try {
    await reader.readString(consume, Math.ceil(DEFAULT_MAX_UPLOAD_BYTES / 3) * 4 + 4);
    if (encodedTail.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encodedTail)) {
      throw new Error('上游返回的图片编码无效');
    }
    if (encodedTail) {
      const decoded = Buffer.from(encodedTail, 'base64');
      decodedBytes += decoded.length;
      if (decodedBytes > DEFAULT_MAX_UPLOAD_BYTES) throw new Error('生成图片超过允许的大小限制');
      if (!sinkError) {
        try { await writeStreamChunk(stream, decoded); }
        catch (error) { sinkError = error; }
      }
    }
    if (decodedBytes === 0) throw new Error('上游返回的图片内容为空');
    if (sinkError) stream.destroy(sinkError);
    else stream.end();
    return { decodedBytes, sinkError };
  } catch (error) {
    stream.destroy(error);
    throw error;
  }
}

async function parseJsonValue(reader, depth = 0) {
  if (depth > 64) throw new Error('上游图片响应嵌套层级过深');
  await reader.skipWhitespace();
  const first = await reader.peek();
  if (first === '"') {
    let value = '';
    await reader.readString(chunk => { value += chunk; }, 1024 * 1024);
    return value;
  }
  if (first === '{') {
    await reader.next();
    const object = {};
    await reader.skipWhitespace();
    if (await reader.peek() === '}') { await reader.next(); return object; }
    while (true) {
      await reader.skipWhitespace();
      const key = await readSmallJsonString(reader, 256);
      await reader.skipWhitespace(); await reader.expect(':');
      object[key] = await parseJsonValue(reader, depth + 1);
      await reader.skipWhitespace();
      const delimiter = await reader.next();
      if (delimiter === '}') return object;
      if (delimiter !== ',') throw new Error('上游图片响应格式无效');
    }
  }
  if (first === '[') {
    await reader.next();
    const values = [];
    await reader.skipWhitespace();
    if (await reader.peek() === ']') { await reader.next(); return values; }
    while (true) {
      values.push(await parseJsonValue(reader, depth + 1));
      await reader.skipWhitespace();
      const delimiter = await reader.next();
      if (delimiter === ']') return values;
      if (delimiter !== ',') throw new Error('上游图片响应格式无效');
    }
  }
  let token = '';
  while (true) {
    const character = await reader.peek();
    if (character === null || /[\s,}\]]/.test(character)) break;
    token += await reader.next();
    if (token.length > 128) throw new Error('上游图片响应格式无效');
  }
  if (token === 'true') return true;
  if (token === 'false') return false;
  if (token === 'null') return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token)) return Number(token);
  throw new Error('上游图片响应格式无效');
}

async function readSmallJsonString(reader, maxCharacters) {
  let value = '';
  await reader.readString(chunk => { value += chunk; }, maxCharacters);
  return value;
}

async function parseImageOutput(reader, index, onBase64Output) {
  await reader.expect('{');
  const output = {};
  let savePromise = null;
  await reader.skipWhitespace();
  if (await reader.peek() === '}') { await reader.next(); return output; }
  while (true) {
    await reader.skipWhitespace();
    const key = await readSmallJsonString(reader, 256);
    await reader.skipWhitespace(); await reader.expect(':');
    await reader.skipWhitespace();
    if (key === 'b64_json' && await reader.peek() === '"') {
      if (output.__hasBase64) throw new Error('上游图片响应重复包含图片字段');
      output.__hasBase64 = true;
      const body = new PassThrough({ highWaterMark: 64 * 1024 });
      body.on('error', () => {});
      savePromise = Promise.resolve()
        .then(() => onBase64Output(index, { body }))
        .then(value => ({ value }), error => ({ error }));
      await readBase64StringToStream(reader, body);
    } else {
      output[key] = await parseJsonValue(reader, 1);
    }
    await reader.skipWhitespace();
    const delimiter = await reader.next();
    if (delimiter === '}') break;
    if (delimiter !== ',') throw new Error('上游图片响应格式无效');
  }
  if (savePromise) {
    const saved = await savePromise;
    if (saved.error) output.__saveError = String(saved.error?.message || '图片保存失败').slice(0, 300);
    else output.__savedOutput = saved.value;
  }
  return output;
}

async function parseImageGenerationResponse(source, onBase64Output, maxBytes) {
  const reader = createStreamingJsonReader(source, maxBytes);
  await reader.skipWhitespace(); await reader.expect('{');
  const payload = {};
  await reader.skipWhitespace();
  if (await reader.peek() === '}') { await reader.next(); return payload; }
  while (true) {
    await reader.skipWhitespace();
    const key = await readSmallJsonString(reader, 256);
    await reader.skipWhitespace(); await reader.expect(':');
    await reader.skipWhitespace();
    if (key === 'data' && await reader.peek() === '[') {
      await reader.next();
      const outputs = [];
      await reader.skipWhitespace();
      if (await reader.peek() !== ']') {
        while (true) {
          await reader.skipWhitespace();
          outputs.push(await reader.peek() === '{'
            ? await parseImageOutput(reader, outputs.length, onBase64Output)
            : await parseJsonValue(reader));
          await reader.skipWhitespace();
          const delimiter = await reader.next();
          if (delimiter === ']') break;
          if (delimiter !== ',') throw new Error('上游图片响应格式无效');
        }
      } else await reader.next();
      payload[key] = outputs;
    } else {
      payload[key] = await parseJsonValue(reader);
    }
    await reader.skipWhitespace();
    const delimiter = await reader.next();
    if (delimiter === '}') break;
    if (delimiter !== ',') throw new Error('上游图片响应格式无效');
  }
  await reader.skipWhitespace();
  if (await reader.peek() !== null) throw new Error('上游图片响应包含多余内容');
  return payload;
}

async function readUpstreamErrorText(source, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const value of source) {
    if (size >= maxBytes) { source.destroy(); break; }
    const chunk = Buffer.from(value);
    const take = Math.min(chunk.length, maxBytes - size);
    if (take) { chunks.push(chunk.subarray(0, take)); size += take; }
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

async function callUpstreamImageStreaming(channel, bodyObj, onBase64Output) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = buildUpstreamImageUrl(channel.base_url); } catch (error) { reject(error); return; }
    const lib = url.protocol === "https:" ? https : http;
    const forwardBody = JSON.stringify(bodyObj);
    const proxyReq = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${channel.api_key}`,
        "Content-Length": Buffer.byteLength(forwardBody),
      },
      timeout: 600000,
    }, (upstreamRes) => {
      const status = upstreamRes.statusCode || 502;
      if (status < 200 || status >= 300) {
        void readUpstreamErrorText(upstreamRes).then(text => {
          let payload = {};
          try { payload = JSON.parse(text); } catch {}
          resolve({ status, text, payload });
        }, reject);
        return;
      }
      const outputCount = Math.max(1, Math.min(15, Number(bodyObj.n) || 1));
      const maxResponseBytes = Math.ceil(DEFAULT_MAX_UPLOAD_BYTES * outputCount * 4 / 3) + 4 * 1024 * 1024;
      void parseImageGenerationResponse(upstreamRes, onBase64Output, maxResponseBytes)
        .then(payload => resolve({ status, payload }))
        .catch(reject);
    });
    proxyReq.on("error", (e) => reject(e));
    proxyReq.on("timeout", () => { proxyReq.destroy(); reject(new Error("生成超时")); });
    proxyReq.write(forwardBody);
    proxyReq.end();
  });
}

// 上游给图片地址时保留响应流，避免先把整张图片读进服务器内存。
async function fetchUrlAsStream(imageUrl) {
  return await new Promise((resolve, reject) => {
    let target;
    try { target = new URL(imageUrl); } catch { return reject(new Error("无效图片 URL")); }
    if (!['http:', 'https:'].includes(target.protocol)) return reject(new Error("图片 URL 协议无效"));
    const lib = target.protocol === "https:" ? https : http;
    const req = lib.request({
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      path: target.pathname + target.search,
      method: "GET",
      timeout: 30000,
    }, (upstreamRes) => {
      if (upstreamRes.statusCode >= 300) { upstreamRes.resume(); return reject(new Error("图片下载失败: " + upstreamRes.statusCode)); }
      const rawLength = upstreamRes.headers['content-length'];
      const contentLength = rawLength !== undefined && /^\d+$/.test(String(rawLength)) ? Number(rawLength) : undefined;
      if (contentLength !== undefined && (!Number.isSafeInteger(contentLength) || contentLength > DEFAULT_MAX_UPLOAD_BYTES)) {
        upstreamRes.destroy();
        return reject(new Error('生成图片超过允许的大小限制'));
      }
      resolve({ body: upstreamRes, contentLength, contentType: String(upstreamRes.headers['content-type'] || '').split(';')[0].toLowerCase() });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("图片下载超时")); });
    req.end();
  });
}

function sniffGeneratedMediaMime(type, prefix, reportedType = '') {
  if (type === 'image') return sniffImageMime(prefix);
  const reported = String(reportedType || '').split(';')[0].trim().toLowerCase();
  if (reported.startsWith(`${type}/`) && !reported.includes('json')) return reported;
  if (type === 'video') {
    if (prefix.length >= 8 && prefix.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
    if (prefix.length >= 4 && prefix[0] === 0x1a && prefix[1] === 0x45 && prefix[2] === 0xdf && prefix[3] === 0xa3) return 'video/webm';
  }
  if (type === 'audio') {
    if (prefix.subarray(0, 3).toString('ascii') === 'ID3') return 'audio/mpeg';
    if (prefix.length >= 2 && prefix[0] === 0xff && (prefix[1] & 0xe0) === 0xe0) return 'audio/mpeg';
    if (prefix.subarray(0, 4).toString('ascii') === 'OggS') return 'audio/ogg';
    if (prefix.subarray(0, 4).toString('ascii') === 'fLaC') return 'audio/flac';
    if (prefix.subarray(0, 4).toString('ascii') === 'RIFF' && prefix.subarray(8, 12).toString('ascii') === 'WAVE') return 'audio/wav';
  }
  throw new Error(`上游返回内容不是有效的${type === 'video' ? '视频' : '音频'}文件`);
}

async function callUpstreamImageEditStreaming(channel, bodyObj, referenceFiles, onBase64Output) {
  if (!Array.isArray(referenceFiles) || referenceFiles.length < 1 || referenceFiles.length > 100) {
    throw new Error('参考图数量无效');
  }
  const boundary = `qingyu-${crypto.randomBytes(24).toString('hex')}`;
  const fields = Object.entries(bodyObj).filter(([key, value]) => /^[a-zA-Z0-9_-]{1,64}$/.test(key) && key !== 'referenceAssetIds' && value !== undefined && value !== null && ['string','number','boolean'].includes(typeof value));
  const fieldParts = fields.map(([key, value]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${String(value)}\r\n`));
  const fileParts = [];
  for (let index = 0; index < referenceFiles.length; index += 1) {
    const file = referenceFiles[index];
    if (file.storageProvider !== 'cos' || file.bucket !== objectStore.getBucket() || file.mediaType !== 'image'
      || !String(file.mimeType || '').startsWith('image/') || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1
      || file.sizeBytes > DEFAULT_MAX_UPLOAD_BYTES || !file.objectKey) {
      throw new Error('参考图未保存、格式无效或不属于当前存储空间');
    }
    const mimeType = String(file.mimeType).replace(/[\r\n]/g, '').slice(0, 120);
    const extension = extForMime(mimeType) || 'bin';
    const name = referenceFiles.length > 1 ? 'image[]' : 'image';
    const header = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="reference-${index + 1}.${extension}"\r\nContent-Type: ${mimeType}\r\n\r\n`);
    fileParts.push({ file, header, tail: Buffer.from('\r\n') });
  }
  const closing = Buffer.from(`--${boundary}--\r\n`);
  const contentLength = fieldParts.reduce((sum, part) => sum + part.length, 0)
    + fileParts.reduce((sum, part) => sum + part.header.length + part.file.sizeBytes + part.tail.length, 0)
    + closing.length;
  if (!Number.isSafeInteger(contentLength) || contentLength > DEFAULT_MAX_UPLOAD_BYTES) throw new Error('参考图总大小超过允许限制');
  const url = buildUpstreamImageEditUrl(channel.base_url);
  const lib = url.protocol === 'https:' ? https : http;
  const body = Readable.from((async function* () {
    for (const part of fieldParts) yield part;
    for (const { file, header, tail } of fileParts) {
      yield header;
      const stored = await objectStore.getObjectStream(file.objectKey);
      for await (const chunk of stored.stream) yield chunk;
      yield tail;
    }
    yield closing;
  })());
  return await new Promise((resolve, reject) => {
    const proxyReq = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': contentLength,
        Authorization: `Bearer ${channel.api_key}`,
      },
      timeout: 600000,
    }, upstreamRes => {
      const status = upstreamRes.statusCode || 502;
      if (status < 200 || status >= 300) {
        void readUpstreamErrorText(upstreamRes).then(text => {
          let payload = {};
          try { payload = JSON.parse(text); } catch {}
          resolve({ status, text, payload });
        }, reject);
        return;
      }
      const maxResponseBytes = Math.ceil(DEFAULT_MAX_UPLOAD_BYTES * Math.max(1, Math.min(15, Number(bodyObj.n) || 1)) * 4 / 3) + 4 * 1024 * 1024;
      void parseImageGenerationResponse(upstreamRes, onBase64Output, maxResponseBytes)
        .then(payload => resolve({ status, payload }))
        .catch(reject);
    });
    proxyReq.on('error', reject);
    proxyReq.on('timeout', () => { proxyReq.destroy(); reject(new Error('生成超时')); });
    body.on('error', error => { proxyReq.destroy(error); reject(error); });
    body.pipe(proxyReq);
  });
}

async function peekStreamPrefix(source, prefixSize = 12) {
  const iterator = source[Symbol.asyncIterator]();
  const chunks = [];
  let size = 0;
  let pending = null;
  let ended = false;
  while (size < prefixSize) {
    const next = await iterator.next();
    if (next.done) { ended = true; break; }
    const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
    const take = Math.min(prefixSize - size, chunk.length);
    if (take) { chunks.push(chunk.subarray(0, take)); size += take; }
    if (take < chunk.length) { pending = chunk.subarray(take); break; }
  }
  const prefix = Buffer.concat(chunks, size);
  const body = Readable.from((async function* () {
    if (prefix.length) yield prefix;
    if (pending?.length) yield pending;
    if (!ended) {
      for (;;) {
        const next = await iterator.next();
        if (next.done) break;
        yield next.value;
      }
    }
  })());
  return { prefix, body };
}

// 把生成图直接写 COS，再登记 file_objects/generation_outputs；不允许退回本地磁盘或数据库正文。
async function persistGeneratedImage(identity, task, attemptId, index, source, revisedPrompt, slot = null) {
  if (!postgresBilling?.recordGeneratedOutput || !task.workspaceId) throw new Error('COS 图片保存所需的数据库或空间信息不可用');
  slot ||= await postgresBilling.reserveGeneratedOutput(identity.sub, task.id, attemptId, index, {
    bucket: objectStore.getBucket(),
  });
  const body = Buffer.isBuffer(source.body) ? Readable.from([source.body]) : source.body || source;
  const contentLength = source && typeof source === 'object' && Number.isSafeInteger(source.contentLength) ? source.contentLength : undefined;
  const { prefix, body: replayableBody } = await peekStreamPrefix(body);
  const mime = sniffImageMime(prefix);
  const put = await objectStore.putObject({ key: slot.objectKey, body: replayableBody, contentLength, contentType: mime, preserveOnError: true });
  const rec = await postgresBilling.recordGeneratedOutput(identity.sub, task.id, {
    ...put, index, fileId: slot.fileId, outputId: slot.outputId, revisedPrompt: revisedPrompt || null,
  });
  return { type: "image", index, b64_json: null, url: null, fileId: rec.fileId, objectKey: slot.objectKey, revisedPrompt: revisedPrompt || null };
}

async function persistGeneratedImageUrl(identity, task, attemptId, index, imageUrl, revisedPrompt, slot = null) {
  slot ||= await postgresBilling.reserveGeneratedOutput(identity.sub, task.id, attemptId, index, {
    bucket: objectStore.getBucket(), recoveryUrl: imageUrl, revisedPrompt,
  });
  const source = await fetchUrlAsStream(imageUrl);
  return persistGeneratedImage(identity, task, attemptId, index, source, revisedPrompt, slot);
}

// 部分上游（如麦子 nano-banana 系列）提交后返回 task_id，需要轮询查询接口拿结果。
// 探测到 data[0].task_id 且无 b64_json/url 时自动走这个分支。
async function pollAsyncUpstreamTask(channel, taskId, timeoutMs = 600000) {
  const base = String(channel.base_url || "").replace(/\/+$/, "");
  const pollUrl = /\/v1$/i.test(base) ? `${base}/tasks/${taskId}` : `${base}/v1/tasks/${taskId}`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) throw new Error("上游异步任务轮询超时");
    const res = await new Promise((resolve, reject) => {
      const target = new URL(pollUrl);
      const lib = target.protocol === "https:" ? https : http;
      const req = lib.request({
        hostname: target.hostname,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        path: target.pathname, method: "GET",
        headers: { Authorization: `Bearer ${channel.api_key}` },
        timeout: 15000,
      }, (upstreamRes) => {
        const chunks = [];
        upstreamRes.on("data", ch => chunks.push(ch));
        upstreamRes.on("end", () => resolve({ status: upstreamRes.statusCode, text: Buffer.concat(chunks).toString("utf-8") }));
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("轮询请求超时")); });
      req.end();
    });
    if (res.status >= 300) throw new Error(`轮询查询失败: HTTP ${res.status}`);
    let body = {};
    try { body = JSON.parse(res.text); } catch {}
    const st = String(body.status || "").toLowerCase();
    if (st === "completed" || st === "succeeded" || st === "success") {
      return body;
    }
    if (st === "failed" || st === "error" || st === "canceled" || st === "cancelled" || st === "violation") {
      const error = new Error(body.error_msg || body.error?.message || (st === "violation" ? "内容审核未通过" : "上游任务执行失败"));
      error.code = 'UPSTREAM_TASK_TERMINAL_FAILURE';
      throw error;
    }
    // queued / pending / processing 都继续等待
    await new Promise(r => setTimeout(r, 5000));
  }
}

function mediaUpstreamUrl(channel, suffix) {
  const base = String(channel.base_url || '').replace(/\/+$/, '');
  return new URL(`${base}${suffix.startsWith('/') ? suffix : `/${suffix}`}`);
}

async function callUpstreamMediaJson(channel, suffix, bodyObj) {
  const url = mediaUpstreamUrl(channel, suffix);
  const lib = url.protocol === 'https:' ? https : http;
  const body = JSON.stringify(bodyObj);
  return await new Promise((resolve, reject) => {
    const request = lib.request({ hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search, method: 'POST', headers: { Authorization: `Bearer ${channel.api_key}`,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Accept: 'application/json' }, timeout: 120000 }, response => {
      const chunks = []; let bytes = 0;
      response.on('data', chunk => { bytes += chunk.length; if (bytes <= 2 * 1024 * 1024) chunks.push(chunk); });
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let payload = {}; try { payload = JSON.parse(text); } catch {}
        resolve({ status: response.statusCode || 502, payload, text });
      });
    });
    request.on('error', reject);
    request.on('timeout', () => { request.destroy(); reject(new Error('媒体生成请求超时')); });
    request.end(body);
  });
}

async function callUpstreamAudioStream(channel, bodyObj, onAccepted) {
  const url = mediaUpstreamUrl(channel, '/audio/speech');
  const lib = url.protocol === 'https:' ? https : http;
  const body = JSON.stringify(bodyObj);
  return await new Promise((resolve, reject) => {
    const request = lib.request({ hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search, method: 'POST', headers: { Authorization: `Bearer ${channel.api_key}`,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Accept: 'audio/*, application/json' }, timeout: 600000 }, response => {
      const contentType = String(response.headers['content-type'] || '').split(';')[0].toLowerCase();
      const status = response.statusCode || 502;
      if (status < 200 || status >= 300 || !contentType.startsWith('audio/')) {
        void readUpstreamErrorText(response).then(text => {
          let payload = {}; try { payload = JSON.parse(text); } catch {}
          resolve({ status: status < 300 ? 502 : status, payload, text });
        }, reject);
        return;
      }
      void Promise.resolve(onAccepted()).then(() => {
        const rawLength = response.headers['content-length'];
        const contentLength = rawLength !== undefined && /^\d+$/.test(String(rawLength)) ? Number(rawLength) : undefined;
        resolve({ status, contentType, contentLength, body: response });
      }, error => { response.destroy(); reject(error); });
    });
    request.on('error', reject);
    request.on('timeout', () => { request.destroy(); reject(new Error('音频生成请求超时')); });
    request.end(body);
  });
}

function isMiniMaxSpeechModel(model) {
  return /^speech-(?:2\.8|2\.6|02|01)-(?:hd|turbo)$/i.test(String(model || '').trim());
}

async function callUpstreamMiniMaxAudio(channel, { model, text, voice, speed, format }, onAccepted) {
  const normalizedFormat = String(format || 'mp3').toLowerCase();
  if (!['mp3', 'wav', 'flac'].includes(normalizedFormat)) {
    throw new Error('MiniMax 语音目前只支持 MP3、WAV 或 FLAC 格式');
  }
  const voiceId = String(voice || 'alloy') === 'alloy' ? 'male-qn-qingse' : String(voice || 'male-qn-qingse');
  const bodyObj = {
    model: String(model || ''), text: String(text || ''), stream: false,
    voice_setting: { voice_id: voiceId, speed: Math.max(0.5, Math.min(2, Number(speed) || 1)), vol: 1, pitch: 0 },
    audio_setting: { sample_rate: 32000, bitrate: 128000, format: normalizedFormat, channel: 1 },
    output_format: 'hex',
  };
  // 沿用该渠道已配置且有响应的语音路由；其报错表明它要求 MiniMax 原生 body schema。
  const url = mediaUpstreamUrl(channel, '/audio/speech');
  const lib = url.protocol === 'https:' ? https : http;
  const body = JSON.stringify(bodyObj);
  return await new Promise((resolve, reject) => {
    const request = lib.request({ hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search, method: 'POST', headers: { Authorization: `Bearer ${channel.api_key}`,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Accept: 'application/json, audio/*' }, timeout: 600000 }, response => {
      const status = response.statusCode || 502;
      const responseType = String(response.headers['content-type'] || '').split(';')[0].toLowerCase();
      if (status >= 200 && status < 300 && responseType.startsWith('audio/')) {
        const rawLength = response.headers['content-length'];
        const contentLength = rawLength !== undefined && /^\d+$/.test(String(rawLength)) ? Number(rawLength) : undefined;
        void Promise.resolve(onAccepted()).then(() => resolve({ status, contentType: responseType, contentLength, body: response }), error => {
          response.destroy(); reject(error);
        });
        return;
      }
      const chunks = []; let bytes = 0; let tooLarge = false;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 48 * 1024 * 1024) { tooLarge = true; response.destroy(); return; }
        chunks.push(chunk);
      });
      response.on('end', async () => {
        if (tooLarge) { reject(new Error('MiniMax 音频响应超过允许大小')); return; }
        const raw = Buffer.concat(chunks, bytes).toString('utf8');
        let payload = {}; try { payload = JSON.parse(raw); } catch {}
        if (status < 200 || status >= 300 || (payload.base_resp?.status_code != null && Number(payload.base_resp.status_code) !== 0)) {
          resolve({ status: status < 300 ? 502 : status, payload, text: raw });
          return;
        }
        try {
          await onAccepted();
          const audioHex = payload?.data?.audio;
          if (typeof audioHex !== 'string' || !/^(?:[\da-f]{2})+$/i.test(audioHex)) throw new Error('MiniMax 没有返回有效的十六进制音频');
          const audio = Buffer.from(audioHex, 'hex');
          const contentType = normalizedFormat === 'mp3' ? 'audio/mpeg' : `audio/${normalizedFormat}`;
          resolve({ status, contentType, contentLength: audio.length, body: Readable.from([audio]) });
        } catch (error) { reject(error); }
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    request.on('timeout', () => { request.destroy(); reject(new Error('音频生成请求超时')); });
    request.end(body);
  });
}

async function readStoredImageDataUrl(file) {
  if (file.storageProvider !== 'cos' || file.bucket !== objectStore.getBucket() || file.mediaType !== 'image'
      || !String(file.mimeType || '').startsWith('image/') || !Number.isSafeInteger(file.sizeBytes)
      || file.sizeBytes < 1 || file.sizeBytes > 20 * 1024 * 1024) throw new Error('视频参考图片无效或超过 20 MB');
  const stored = await objectStore.getObjectStream(file.objectKey);
  const chunks = []; let length = 0;
  for await (const value of stored.stream) {
    const chunk = Buffer.from(value); length += chunk.length;
    if (length > 20 * 1024 * 1024) throw new Error('视频参考图片超过 20 MB');
    chunks.push(chunk);
  }
  return `data:${file.mimeType};base64,${Buffer.concat(chunks, length).toString('base64')}`;
}

async function persistGeneratedMedia(identity, task, attemptId, index, source, outputType, slot = null) {
  slot ||= await postgresBilling.reserveGeneratedOutput(identity.sub, task.id, attemptId, index,
    { bucket: objectStore.getBucket(), outputType });
  const body = Buffer.isBuffer(source.body) ? Readable.from([source.body]) : source.body;
  const { prefix, body: replayableBody } = await peekStreamPrefix(body);
  const mime = sniffGeneratedMediaMime(outputType, prefix, source.contentType);
  const saved = await objectStore.putObject({ key: slot.objectKey, body: replayableBody,
    contentLength: source.contentLength, contentType: mime, preserveOnError: true });
  const registered = await postgresBilling.recordGeneratedOutput(identity.sub, task.id, {
    ...saved, index, fileId: slot.fileId, outputId: slot.outputId, durationMs: source.durationMs || null,
  });
  return { type: outputType, index, fileId: registered.fileId, objectKey: slot.objectKey,
    mimeType: mime, sizeBytes: saved.sizeBytes };
}

function mediaVideoResultUrl(body) {
  const list = body?.result_urls || body?.urls || body?.data?.result_urls || body?.data?.urls || [];
  const candidate = (Array.isArray(list) ? list : []).find(value => typeof value === 'string' && /^https?:\/\//i.test(value));
  if (candidate) return candidate;
  const nested = body?.data && typeof body.data === 'object' ? body.data : body;
  return [nested?.video_url, nested?.result_url, nested?.url, nested?.content?.video_url, nested?.content?.url]
    .find(value => typeof value === 'string' && /^https?:\/\//i.test(value)) || null;
}

async function runGenerationTaskMediaWorker(identity, task, channel, params, recovery = {}) {
  let claimed = task.status === 'running';
  let attemptId = recovery.attemptId || null;
  let providerTaskId = recovery.providerTaskId || null;
  let responseComplete = false;
  let outputSlot = null;
  try {
    if (!claimed) {
      claimed = await postgresBilling.markTaskRunning(identity.sub, task.id, null);
      if (!claimed) return;
      const attempt = await postgresBilling.beginGenerationAttempt(identity.sub, task.id);
      attemptId = attempt.attemptId;
    } else if (task.taskType !== 'video' || !attemptId || !providerTaskId) {
      return; // 音频没有可续查的供应商任务号；避免进程重启后重复调用并重复收费。
    }

    if (task.taskType === 'video') {
      const duration = Math.max(1, Math.min(120, Number(params.duration) || 6));
      if (!providerTaskId) {
        const refs = await postgresBilling.listGenerationInputFiles(identity.sub, task.id);
        const images = await Promise.all(refs.filter(file => file.mediaType === 'image').map(readStoredImageDataUrl));
        const requestBody = { model: task.model, prompt: task.prompt, ratio: String(params.ratio || '16:9'),
          resolution: String(params.resolution || '720p'), duration,
          generate_audio: params.generateAudio !== false, watermark: params.watermark === true };
        if (params.mode === 'frames') {
          if (images[0]) requestBody.first_frame = images[0];
          if (images[1]) requestBody.last_frame = images[1];
        } else if (images.length) requestBody.reference_images = images;
        const created = await callUpstreamMediaJson(channel, '/videos/generations', requestBody);
        if (created.status < 200 || created.status >= 300) throw new Error(created.payload?.error?.message || created.payload?.message || created.text || `上游返回状态 ${created.status}`);
        providerTaskId = created.payload?.id || created.payload?.data?.id || created.payload?.task_id || created.payload?.data?.task_id;
        if (!providerTaskId || typeof providerTaskId !== 'string') throw new Error('上游没有返回视频任务编号');
        await postgresBilling.setGenerationAttemptProviderTask(identity.sub, task.id, attemptId, providerTaskId);
      }
      const done = await pollAsyncUpstreamTask(channel, providerTaskId, 1500000);
      const videoUrl = mediaVideoResultUrl(done);
      if (!videoUrl) {
        await postgresBilling.completeGenerationAttempt(identity.sub, task.id, attemptId, 0, providerTaskId);
        responseComplete = true;
        await postgresBilling.settleGenerationTaskIfComplete(identity.sub, task.id, providerTaskId);
        return;
      }
      outputSlot = await postgresBilling.reserveGeneratedOutput(identity.sub, task.id, attemptId, 0,
        { bucket: objectStore.getBucket(), recoveryUrl: videoUrl, outputType: 'video' });
      await postgresBilling.completeGenerationAttempt(identity.sub, task.id, attemptId, 1, providerTaskId);
      responseComplete = true;
      const source = await fetchUrlAsStream(videoUrl);
      source.durationMs = duration * 1000;
      await persistGeneratedMedia(identity, task, attemptId, 0, source, 'video', outputSlot);
    } else if (task.taskType === 'audio') {
      const format = String(params.format || 'mp3').toLowerCase();
      outputSlot = await postgresBilling.reserveGeneratedOutput(identity.sub, task.id, attemptId, 0,
        { bucket: objectStore.getBucket(), outputType: 'audio', extension: format });
      const audioSettings = { model: task.model, text: task.prompt,
        voice: String(params.voice || 'alloy'), format,
        speed: Math.max(0.25, Math.min(4, Number(params.speed) || 1)),
        ...(params.instructions ? { instructions: String(params.instructions).slice(0, 4000) } : {}) };
      const onAccepted = async () => { await postgresBilling.completeGenerationAttempt(identity.sub, task.id, attemptId, 1); responseComplete = true; };
      const response = isMiniMaxSpeechModel(task.model)
        ? await callUpstreamMiniMaxAudio(channel, audioSettings, onAccepted)
        : await callUpstreamAudioStream(channel, { model: task.model, input: task.prompt,
          voice: audioSettings.voice, response_format: format, speed: audioSettings.speed,
          ...(audioSettings.instructions ? { instructions: audioSettings.instructions } : {}) }, onAccepted);
      if (response.status < 200 || response.status >= 300) throw new Error(response.payload?.error?.message || response.payload?.message || response.text || `上游返回状态 ${response.status}`);
      await persistGeneratedMedia(identity, task, attemptId, 0, response, 'audio', outputSlot);
    }
    await postgresBilling.settleGenerationTaskIfComplete(identity.sub, task.id, providerTaskId || null);
  } catch (error) {
    console.error('[media-task]', task.id, error.message);
    if (!claimed) return;
    try {
      if (responseComplete) await postgresBilling.settleGenerationTaskIfComplete(identity.sub, task.id, providerTaskId || null);
      else if (task.taskType === 'video' && providerTaskId && error.code === 'UPSTREAM_TASK_TERMINAL_FAILURE') {
        await postgresBilling.failTask(identity.sub, task.id, 'upstream_task_failed', String(error.message || '视频生成失败').slice(0, 500), true);
      }
      else if (task.taskType === 'video' && providerTaskId) {
        setTimeout(() => runGenerationTaskMediaWorker(identity, { ...task, status: 'running' }, channel, params,
          { attemptId, providerTaskId }), 15000).unref?.();
      } else await postgresBilling.failTask(identity.sub, task.id, 'upstream_error', String(error.message || '媒体生成失败').slice(0, 500), true);
    } catch (settleError) { console.error('[media-task settlement]', task.id, settleError.message); }
  }
}

async function runGenerationTaskWorker(identity, task, channel, bodyObj) {
  let claimed = false;
  let attempt = null;
  let responseComplete = false;
  try {
    claimed = await postgresBilling.markTaskRunning(identity.sub, task.id, null);
    if (!claimed) return;
    attempt = await postgresBilling.beginGenerationAttempt(identity.sub, task.id);
    bodyObj = { ...bodyObj };
    delete bodyObj.__qingyuCatalogModelId;
    const referenceFiles = await postgresBilling.listGenerationInputFiles(identity.sub, task.id);
    const { status, payload = {}, text = '' } = await callUpstreamImage(
      channel,
      bodyObj,
      (index, source) => persistGeneratedImage(identity, task, attempt.attemptId, index, source, null),
      referenceFiles,
    );
    if (status >= 200 && status < 300 && Array.isArray(payload.data)) {
      // 部分上游返回 task_id 走异步轮询（如麦子 nano-banana）
      const first = payload.data[0] || {};
      if (first.task_id && !first.__hasBase64 && !first.b64_json && !first.url) {
        const done = await pollAsyncUpstreamTask(channel, first.task_id);
        const urls = done.result_urls || done.urls || [];
        const slots = [];
        for (let i = 0; i < urls.length; i++) {
          slots.push(await postgresBilling.reserveGeneratedOutput(identity.sub, task.id, attempt.attemptId, i, {
            bucket: objectStore.getBucket(), recoveryUrl: urls[i],
          }));
        }
        await postgresBilling.completeGenerationAttempt(identity.sub, task.id, attempt.attemptId, urls.length, done.id || first.task_id || null);
        responseComplete = true;
        if (!urls.length) {
          await postgresBilling.failTask(identity.sub, task.id, "empty_output", "上游异步任务完成但未返回图片", true);
          return;
        }
        const outputs = [];
        for (let i = 0; i < urls.length; i++) {
          try {
            outputs.push(await persistGeneratedImageUrl(identity, task, attempt.attemptId, i, urls[i], null, slots[i]));
          }
          catch (dlErr) { console.error("[async task] image download failed", task.id, dlErr.message); }
        }
        await postgresBilling.settleGenerationTaskIfComplete(identity.sub, task.id, done.id || first.task_id || null);
        return;
      }
      // 先筛出至少带一种可用图片引用的条目；一个都没有则视为"没出图"，必须退款，不能结算。
      const raw = payload.data.map((d, i) => ({
        type: "image", index: i,
        hasBase64: d.__hasBase64 === true, savedOutput: d.__savedOutput || null, saveError: d.__saveError || null,
        b64_json: d.b64_json || null, url: d.url || null,
        revisedPrompt: d.revised_prompt || null,
      })).filter(o => o.hasBase64 || o.b64_json || o.url);
      const slotsByIndex = new Map();
      for (const output of raw) {
        if (!output.url || output.hasBase64) continue;
        slotsByIndex.set(output.index, await postgresBilling.reserveGeneratedOutput(identity.sub, task.id, attempt.attemptId, output.index, {
          bucket: objectStore.getBucket(), recoveryUrl: output.url, revisedPrompt: output.revisedPrompt,
        }));
      }
      await postgresBilling.completeGenerationAttempt(identity.sub, task.id, attempt.attemptId, raw.length, payload.id || null);
      responseComplete = true;
      if (raw.length === 0) {
        await postgresBilling.failTask(identity.sub, task.id, "empty_output", "上游返回成功但未包含任何图片", true);
        return;
      }
      // 直接以受限流写入对象存储，不先将图片完整解码或下载到服务器内存；单张失败不影响其他图。
      const outputs = [];
      for (const o of raw) {
        try {
          if (o.savedOutput) {
            outputs.push({ ...o.savedOutput, revisedPrompt: o.revisedPrompt || null });
            continue;
          }
          if (o.hasBase64 || o.saveError) {
            console.error("[task worker] image upload failed", task.id, o.saveError || 'Base64 图片未保存');
            continue;
          }
          outputs.push(await persistGeneratedImageUrl(identity, task, attempt.attemptId, o.index, o.url, o.revisedPrompt || null, slotsByIndex.get(o.index)));
        } catch (dlErr) {
          console.error("[task worker] image url download failed", task.id, dlErr.message);
        }
      }
      await postgresBilling.settleGenerationTaskIfComplete(identity.sub, task.id, payload.id || null);
    } else {
      const msg = (payload && payload.error && payload.error.message) || text || `上游返回状态 ${status}`;
      await postgresBilling.failTask(identity.sub, task.id, "upstream_error", String(msg).slice(0, 500), true);
    }
  } catch (e) {
    console.error("[task worker]", task.id, e.message);
    // 没领取成功的处理者不能释放另一个处理者正在使用的额度。
    if (claimed) {
      try {
        if (responseComplete && attempt?.attemptId) await postgresBilling.settleGenerationTaskIfComplete(identity.sub, task.id);
        else await postgresBilling.failTask(identity.sub, task.id, "upstream_error", e.message, true);
      }
      catch (settlementError) { console.error('[task settlement]', task.id, settlementError.message); }
    }
  }
}

// ===================== 计费路由处理器 =====================
// 返回 true 表示已处理
async function handleBilling(req, res, pathname, method, url) {

  // ---------- 客户端：/api/billing/* ----------
  if (pathname.startsWith("/api/billing/") || pathname === "/api/billing") {

    // POST /api/billing/logout — 撤销当前设备会话并清除 HttpOnly Cookie。
    if (pathname === "/api/billing/logout" && method === "POST") {
      const identity = getBillingIdentity(req);
      if (identity?.role === "customer" && postgresBilling) {
        try {
          await postgresBilling.revokeSession(identity.sub, identity.sid);
        } catch (error) {
          // 已失效的会话无需再次撤销；数据库故障则报告失败，但仍清掉本机 Cookie。
          if (!/会话不存在或已经失效/.test(String(error.message || ""))) {
            console.error("[billing logout] session revocation failed", error.message);
            return sendJSON(res, 503, { error: "退出登录未能同步到服务器，请稍后重试" }, { "Set-Cookie": clearCustomerSessionCookie() });
          }
        }
      }
      return sendJSON(res, 200, { success: true }, { "Set-Cookie": clearCustomerSessionCookie() });
    }

    // POST /api/billing/login — 用 Appwrite 用户 ID 换取客户计费 JWT（前端在 Appwrite 登录成功后调用）
    if (pathname === "/api/billing/login" && method === "POST") {
      const body = await parseBody(req);
      if (!body.userId) return sendJSON(res, 400, { error: "缺少用户标识" });
      const appwriteUser = await verifyAppwriteUser(body.appwriteJwt);
      if (!appwriteUser || appwriteUser.$id !== String(body.userId)) {
        return sendJSON(res, 401, { error: "登录身份校验失败，请重新登录" });
      }
      if (postgresBilling) {
        const user = await postgresBilling.ensureUser(body.userId, body.email || "", body.inviteCode || "", appwriteUser.$createdAt);
        const session = await postgresBilling.registerSession(body.userId, {
          installationId: body.installationId,
          displayName: body.displayName,
          clientType: body.clientType,
          osFamily: body.osFamily,
          browserFamily: body.browserFamily,
        });
        const exp = Math.floor(Date.now() / 1000) + CUSTOMER_SESSION_MAX_AGE_SECONDS;
        const token = signJWT({ sub: body.userId, role: "customer", sid: session.id, iat: Math.floor(Date.now() / 1000), exp });
        return sendJSON(res, 200, { user, session }, { "Set-Cookie": customerSessionCookie(token) });
      }
      // 文件账本仅用于隔离的本地支付测试；正式和普通开发登录必须走 PostgreSQL 会话表。
      if (process.env.NODE_ENV !== "test" || PAYMENT_MODE !== "mock") {
        return sendJSON(res, 503, { error: "登录会话服务暂不可用，请稍后重试" });
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
      const exp = Math.floor(Date.now() / 1000) + CUSTOMER_SESSION_MAX_AGE_SECONDS;
      const token = signJWT({ sub: user.id, role: "customer", sid: crypto.randomUUID(), iat: Math.floor(Date.now() / 1000), exp });
      return sendJSON(res, 200, { user: publicUser(user) }, { "Set-Cookie": customerSessionCookie(token) });
    }

    // 以下客户接口都需要客户 JWT
    const identity = getBillingIdentity(req);
    if (!identity || identity.role !== "customer") {
      return sendJSON(res, 401, { error: "未登录或登录已过期" });
    }
    const me = postgresBilling ? await postgresBilling.getUser(identity.sub) : findUserByAppwriteId(identity.sub);
    if (!me) return sendJSON(res, 404, { error: "用户不存在，请重新登录" });

    if (pathname === "/api/billing/quote" && method === "POST") {
      if (!postgresBilling) return sendJSON(res, 503, { error: "计费数据库暂不可用" });
      if (!(await postgresBilling.isSessionActive(identity.sub, identity.sid || ""))) return sendJSON(res, 401, { error: "当前登录设备已离线，请重新登录" });
      try { return sendJSON(res, 200, await postgresBilling.createModelCreditQuote(identity.sub, await parseBody(req))); }
      catch (error) { return sendJSON(res, /积分|价格|模型|类型|计费目录/.test(String(error.message || "")) ? 400 : 500, { error: error.message }); }
    }

    // GET /api/billing/me
    if (pathname === "/api/billing/me" && method === "GET") {
      if (postgresBilling) {
        const userOut = { ...me };
        return sendJSON(res, 200, { user: userOut, settings: { currency: "CNY", inviteCode: me.inviteCode, inviteRewardQuota: 0 } });
      }
      return sendJSON(res, 200, { user: publicUser(me), settings: {
        currency: billingSettings.currency,
        inviteCode: me.inviteCode,
        inviteRewardQuota: billingSettings.inviteRewardQuota,
      }});
    }

    if (pathname === "/api/billing/renewal-status" && method === "GET") {
      if (postgresBilling) return sendJSON(res, 200, await postgresBilling.getRenewalStatus(identity.sub));
      return sendJSON(res, 200, { automaticRenewalEnabled: false, collectionMode: "manual", mandateStatus: null,
        subscriptionStatus: me.memberActive ? "active" : null, currentPeriodEnd: me.memberExpireAt || null });
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
        catch (error) { return sendJSON(res, error.message.includes("同一") || error.message.includes("订阅") ? 409 : 400, { error: error.message }); }
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
      if (me.memberExpireAt > Date.now() && me.memberLevel !== plan.level) {
        return sendJSON(res, 409, { error: "当前订阅尚未到期，不能直接切换套餐" });
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
      if (PAYMENT_MODE !== 'mock') return sendJSON(res, 503, { error: "支付渠道尚未配置，订单已创建但不能确认付款" });
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
      if (postgresBilling) {
        try { return sendJSON(res, 200, await postgresBilling.redeemCode(identity.sub, code)); }
        catch (error) { return sendJSON(res, 400, { error: error.message || "兑换失败" }); }
      }
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

    // GET /api/billing/invoices — 我的开票申请列表
    if (pathname === "/api/billing/invoices" && method === "GET") {
      if (!postgresBilling) return sendJSON(res, 200, []);
      return sendJSON(res, 200, await postgresBilling.listMyInvoiceRequests(identity.sub));
    }

    // POST /api/billing/invoices — 提交开票申请 { titleType, titleName, taxNo, email, orderIds }
    if (pathname === "/api/billing/invoices" && method === "POST") {
      if (!postgresBilling) return sendJSON(res, 501, { error: "开票服务暂不可用" });
      const body = await parseBody(req);
      try {
        return sendJSON(res, 201, await postgresBilling.createInvoiceRequest(identity.sub, body));
      } catch (error) { return sendJSON(res, 400, { error: error.message }); }
    }

    // GET/POST /api/billing/refunds — 用户查看和提交退款申请
    if (pathname === "/api/billing/refunds" && method === "GET") {
      if (!postgresBilling) return sendJSON(res, 200, []);
      return sendJSON(res, 200, await postgresBilling.listRefunds(identity.sub));
    }
    if (pathname === "/api/billing/refunds" && method === "POST") {
      if (!postgresBilling) return sendJSON(res, 501, { error: "退款服务暂不可用" });
      try { return sendJSON(res, 201, await postgresBilling.createRefundRequest(identity.sub, await parseBody(req))); }
      catch (error) { return sendJSON(res, 400, { error: error.message || "退款申请失败" }); }
    }

    // GET /api/billing/invite — 我的邀请
    if (pathname === "/api/billing/invite" && method === "GET") {
      if (postgresBilling) return sendJSON(res, 200, await postgresBilling.inviteInfo(identity.sub));
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

    // 正式环境的计费事实统一来自 PostgreSQL，避免管理后台继续读旧 JSON 账本。
    if (postgresBilling) {
      if (pathname === '/api/admin/billing/usage/unknown' && method === 'GET') {
        return sendJSON(res, 200, await postgresBilling.adminUnknownUsage());
      }
      const reconciliationMatch = pathname.match(/^\/api\/admin\/billing\/usage\/([0-9a-f-]{36})\/reconcile$/i);
      if (reconciliationMatch && method === 'POST') {
        const body = await parseBody(req);
        if (body.confirm !== true) return sendJSON(res, 400, { error: '请确认供应商核对结论后再提交' });
        try {
          return sendJSON(res, 200, await postgresBilling.adminReconcileUsage(reconciliationMatch[1], adminIdentity.sub, body));
        } catch (error) { return sendJSON(res, 409, { error: error.message || '核对失败，额度未变更' }); }
      }
      if (pathname === "/api/admin/billing/stats" && method === "GET") {
        return sendJSON(res, 200, await postgresBilling.adminStats());
      }
      if (pathname === "/api/admin/billing/quota/audit" && method === "GET") {
        return sendJSON(res, 200, await postgresBilling.adminQuotaAudit());
      }
      if (pathname === "/api/admin/billing/users" && method === "GET") {
        return sendJSON(res, 200, await postgresBilling.adminUsers());
      }
      const pgAdjustMatch = pathname.match(/^\/api\/admin\/billing\/users\/([^/]+)\/adjust$/);
      if (pgAdjustMatch && method === "POST") {
        const body = await parseBody(req);
        return sendJSON(res, 200, await postgresBilling.adminAdjustBalance(pgAdjustMatch[1], body.delta, body.note || "后台调整"));
      }
      if (pathname === "/api/admin/billing/orders" && method === "GET") {
        return sendJSON(res, 200, await postgresBilling.adminOrders());
      }
      if (pathname === "/api/admin/billing/invoices" && method === "GET") {
        return sendJSON(res, 200, await postgresBilling.adminListInvoiceRequests());
      }
      const invoiceUpdateMatch = pathname.match(/^\/api\/admin\/billing\/invoices\/([^/]+)\/(processing|completed|failed)$/);
      if (invoiceUpdateMatch && method === "POST") {
        const body = await parseBody(req);
        try {
          const result = await postgresBilling.adminUpdateInvoiceRequest(invoiceUpdateMatch[1], { status: invoiceUpdateMatch[2], pdfUrl: body.pdfUrl, rejectReason: body.rejectReason });
          void postgresBilling.writeAdminAudit({ actor: (requestIdentity && requestIdentity.sub) || "admin", action: "invoice.update", targetType: "invoice_request", targetId: invoiceUpdateMatch[1], summary: `发票状态更新为 ${invoiceUpdateMatch[2]}`, metadata: { status: invoiceUpdateMatch[2] }, ip: req.socket.remoteAddress }).catch(()=>{});
          return sendJSON(res, 200, result);
        } catch (error) { return sendJSON(res, 400, { error: error.message }); }
      }
      if (pathname === "/api/admin/billing/refunds" && method === "GET") {
        return sendJSON(res, 200, await postgresBilling.adminRefunds());
      }
      const refundUpdateMatch = pathname.match(/^\/api\/admin\/billing\/refunds\/([^/]+)\/(processing|succeeded|failed|unknown)$/);
      if (refundUpdateMatch && method === "POST") {
        const body = await parseBody(req);
        try {
          const result = await postgresBilling.adminUpdateRefund(refundUpdateMatch[1], { status: refundUpdateMatch[2], providerRefundId: body.providerRefundId, note: body.note });
          void postgresBilling.writeAdminAudit({ actor: (requestIdentity && requestIdentity.sub) || "admin", action: "refund.update", targetType: "refund", targetId: refundUpdateMatch[1], summary: `退款状态更新为 ${refundUpdateMatch[2]}`, metadata: { status: refundUpdateMatch[2] }, ip: req.socket.remoteAddress }).catch(()=>{});
          return sendJSON(res, 200, result);
        }
        catch (error) { return sendJSON(res, 400, { error: error.message || "退款处理失败" }); }
      }
      if (pathname === "/api/admin/billing/codes" && method === "GET") {
        return sendJSON(res, 200, await postgresBilling.adminListCodes());
      }
      if (pathname === "/api/admin/billing/codes" && method === "POST") {
        try {
          const body = await parseBody(req);
          const result = await postgresBilling.adminCreateCodes(body);
          void postgresBilling.writeAdminAudit({ actor: (requestIdentity && requestIdentity.sub) || "admin", action: "code.create", targetType: "redeem_code", summary: `批量生成 ${body.count||0} 张兑换码（面额 ${body.denomination||0}）`, metadata: { count: body.count, denomination: body.denomination }, ip: req.socket.remoteAddress }).catch(()=>{});
          return sendJSON(res, 200, result);
        }
        catch (error) { return sendJSON(res, 400, { error: error.message || "兑换码生成失败" }); }
      }
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
      if (postgresBilling) return sendJSON(res, 200, await postgresBilling.plans());
      return sendJSON(res, 200, billingPlans);
    }
    if (pathname === "/api/admin/billing/plans" && method === "PUT") {
      const body = await parseBody(req);
      if (postgresBilling) {
        try { return sendJSON(res, 200, await postgresBilling.updatePlan(body)); }
        catch (error) { return sendJSON(res, error.message === "套餐不存在" ? 404 : 400, { error: error.message }); }
      }
      const idx = billingPlans.findIndex(p => p.id === body.id);
      if (idx === -1) return sendJSON(res, 404, { error: "套餐不存在" });
      Object.assign(billingPlans[idx], body);
      saveJSON(PLANS_FILE, billingPlans);
      return sendJSON(res, 200, billingPlans[idx]);
    }

    // GET /api/admin/billing/settings
    if (pathname === "/api/admin/billing/settings" && method === "GET") {
      if (postgresBilling) billingSettings = await postgresBilling.getSystemSetting("billing", billingSettings);
      return sendJSON(res, 200, billingSettings);
    }
    // PUT /api/admin/billing/settings
    if (pathname === "/api/admin/billing/settings" && method === "PUT") {
      const body = await parseBody(req);
      Object.assign(billingSettings, body);
      if (postgresBilling) {
        billingSettings = await postgresBilling.setSystemSetting("billing", billingSettings);
        return sendJSON(res, 200, billingSettings);
      }
      saveJSON(SETTINGS_FILE, billingSettings);
      return sendJSON(res, 200, billingSettings);
    }

    // GET /api/admin/billing/supplier/balance — 查询供应商账号余额
    if (pathname === "/api/admin/billing/supplier/balance" && method === "GET") {
      const sup = billingSettings.supplier?.maizitech;
      if (!sup?.apiKey) return sendJSON(res, 400, { error: "未配置供应商 API Key" });
      if (!sup?.balanceToken) return sendJSON(res, 400, { error: "未配置供应商余额 Token" });
      try {
        const url = new URL(`${sup.baseUrl}/v1/balance`);
        const result = await new Promise((resolve, reject) => {
          const r = https.request(url, {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${sup.apiKey}`,
              "X-Balance-Token": sup.balanceToken,
            },
            timeout: 10000,
          }, resp => {
            const chunks = [];
            resp.on("data", c => chunks.push(c));
            resp.on("end", () => {
              const text = Buffer.concat(chunks).toString("utf8");
              try { resolve({ status: resp.statusCode, data: JSON.parse(text) }); }
              catch { resolve({ status: resp.statusCode, data: { raw: text } }); }
            });
          });
          r.on("error", reject);
          r.on("timeout", () => { r.destroy(); reject(new Error("请求超时")); });
          r.end();
        });
        return sendJSON(res, result.status, result.data);
      } catch (e) {
        return sendJSON(res, 502, { error: `供应商请求失败: ${e.message}` });
      }
    }

    // GET /api/admin/billing/supplier/key-limits — 查询 API Key 限额
    if (pathname === "/api/admin/billing/supplier/key-limits" && method === "GET") {
      const sup = billingSettings.supplier?.maizitech;
      if (!sup?.apiKey) return sendJSON(res, 400, { error: "未配置供应商 API Key" });
      try {
        const url = new URL(`${sup.baseUrl}/v1/api-key/limits`);
        const result = await new Promise((resolve, reject) => {
          const r = https.request(url, {
            method: "GET",
            headers: { "Authorization": `Bearer ${sup.apiKey}` },
            timeout: 10000,
          }, resp => {
            const chunks = [];
            resp.on("data", c => chunks.push(c));
            resp.on("end", () => {
              const text = Buffer.concat(chunks).toString("utf8");
              try { resolve({ status: resp.statusCode, data: JSON.parse(text) }); }
              catch { resolve({ status: resp.statusCode, data: { raw: text } }); }
            });
          });
          r.on("error", reject);
          r.on("timeout", () => { r.destroy(); reject(new Error("请求超时")); });
          r.end();
        });
        return sendJSON(res, result.status, result.data);
      } catch (e) {
        return sendJSON(res, 502, { error: `供应商请求失败: ${e.message}` });
      }
    }

    // GET /api/admin/billing/supplier/models — 查询模型列表与价格
    if (pathname === "/api/admin/billing/supplier/models" && method === "GET") {
      const sup = billingSettings.supplier?.maizitech;
      if (!sup?.baseUrl) return sendJSON(res, 400, { error: "未配置供应商 Base URL" });
      try {
        const url = new URL(`${sup.baseUrl}/v1/models`);
        const result = await new Promise((resolve, reject) => {
          const r = https.request(url, {
            method: "GET",
            timeout: 10000,
          }, resp => {
            const chunks = [];
            resp.on("data", c => chunks.push(c));
            resp.on("end", () => {
              const text = Buffer.concat(chunks).toString("utf8");
              try { resolve({ status: resp.statusCode, data: JSON.parse(text) }); }
              catch { resolve({ status: resp.statusCode, data: { raw: text } }); }
            });
          });
          r.on("error", reject);
          r.on("timeout", () => { r.destroy(); reject(new Error("请求超时")); });
          r.end();
        });
        return sendJSON(res, result.status, result.data);
      } catch (e) {
        return sendJSON(res, 502, { error: `供应商请求失败: ${e.message}` });
      }
    }

    // GET /api/admin/billing/supplier/announcements — 查询供应商公告
    if (pathname === "/api/admin/billing/supplier/announcements" && method === "GET") {
      const sup = billingSettings.supplier?.maizitech;
      if (!sup?.apiKey) return sendJSON(res, 400, { error: "未配置供应商 API Key" });
      try {
        const url = new URL(`${sup.baseUrl}/api/web/announcements/content`);
        const result = await new Promise((resolve, reject) => {
          const r = https.request(url, {
            method: "GET",
            headers: { "Authorization": `Bearer ${sup.apiKey}` },
            timeout: 10000,
          }, resp => {
            const chunks = [];
            resp.on("data", c => chunks.push(c));
            resp.on("end", () => {
              const text = Buffer.concat(chunks).toString("utf8");
              try { resolve({ status: resp.statusCode, data: JSON.parse(text) }); }
              catch { resolve({ status: resp.statusCode, data: { raw: text } }); }
            });
          });
          r.on("error", reject);
          r.on("timeout", () => { r.destroy(); reject(new Error("请求超时")); });
          r.end();
        });
        return sendJSON(res, result.status, result.data);
      } catch (e) {
        return sendJSON(res, 502, { error: `供应商请求失败: ${e.message}` });
      }
    }

    return false;
  }

  return false;
}

// ===================== 团队路由（业务数据统一走 PostgreSQL） =====================
async function handleTeams(req, res, pathname, method) {
  if (pathname.startsWith('/api/')) pathname = pathname.slice(4);
  if (!postgresBilling || !(pathname === "/teams" || pathname.startsWith("/teams/") || pathname === "/team-invitations/accept")) return false;
  const identity = getBillingIdentity(req);
  if (!identity || identity.role !== "customer") { sendJSON(res, 401, { error: "未登录或登录已过期" }); return true; }
  try {
    if (pathname === "/teams" && method === "GET") {
      return sendJSON(res, 200, await postgresBilling.listTeams(identity.sub));
    }
    if (pathname === "/teams" && method === "POST") {
      const body = await parseBody(req);
      return sendJSON(res, 201, await postgresBilling.createTeam(identity.sub, body.name));
    }
    if (pathname === "/team-invitations/accept" && method === "POST") {
      const body = await parseBody(req);
      return sendJSON(res, 200, await postgresBilling.acceptTeamInvitation(identity.sub, body.token));
    }
    const membersMatch = pathname.match(/^\/teams\/([^/]+)\/members$/);
    if (membersMatch && method === "GET") {
      return sendJSON(res, 200, await postgresBilling.listTeamMembers(identity.sub, membersMatch[1]));
    }
    const inviteMatch = pathname.match(/^\/teams\/([^/]+)\/invite$/);
    if (inviteMatch && method === "POST") {
      const body = await parseBody(req);
      return sendJSON(res, 201, await postgresBilling.inviteToTeam(identity.sub, inviteMatch[1], body.email));
    }
    const memberChangeMatch = pathname.match(/^\/teams\/([^/]+)\/members\/([^/]+)$/);
    if (memberChangeMatch && method === "PATCH") {
      const body = await parseBody(req);
      return sendJSON(res, 200, await postgresBilling.updateTeamMember(identity.sub, memberChangeMatch[1], memberChangeMatch[2], body));
    }
    const departmentMatch = pathname.match(/^\/teams\/([^/]+)\/departments$/);
    if (departmentMatch && method === "GET") {
      return sendJSON(res, 200, await postgresBilling.listDepartments(identity.sub, departmentMatch[1]));
    }
    if (departmentMatch && method === "POST") {
      const body = await parseBody(req);
      return sendJSON(res, 201, await postgresBilling.createDepartment(identity.sub, departmentMatch[1], body.name, body.parentId || null));
    }
    const jobTitleMatch = pathname.match(/^\/teams\/([^/]+)\/job-titles$/);
    if (jobTitleMatch && method === "GET") {
      return sendJSON(res, 200, await postgresBilling.listJobTitles(identity.sub, jobTitleMatch[1]));
    }
    if (jobTitleMatch && method === "POST") {
      const body = await parseBody(req);
      return sendJSON(res, 201, await postgresBilling.createJobTitle(identity.sub, jobTitleMatch[1], body.name));
    }
    sendJSON(res, 404, { error: "团队接口不存在" });
    return true;
  } catch (error) {
    console.error("[teams]", error.message);
    sendJSON(res, 400, { error: error.message || "团队操作失败" });
    return true;
  }
}

async function handleAssets(req, res, pathname, method, url) {
  if (pathname.startsWith('/api/')) pathname = pathname.slice(4);
  if (!postgresBilling || !(pathname === "/content-edits" || pathname === "/assets" || pathname === "/assets/upload" || pathname.startsWith("/assets/") || pathname === "/favorites" || pathname.startsWith("/favorites/"))) return false;
  const identity = getBillingIdentity(req);
  if (!identity || identity.role !== "customer") { sendJSON(res, 401, { error: "未登录或登录已过期" }); return true; }
  try {
    if (pathname === '/content-edits' && method === 'POST') {
      const input = await parseBody(req);
      return sendJSON(res, 201, await postgresBilling.createContentEdit(identity.sub, input));
    }
    if (pathname === '/assets/upload-sessions' && method === 'POST') {
      const input = await parseBody(req);
      const title = String(input.title || '').trim().slice(0, 240);
      const mimeType = String(input.mimeType || 'application/octet-stream').split(';')[0].slice(0, 160);
      if (!title) return sendJSON(res, 400, { error: '文件名称不能为空' });
      const sizeBytes = validateUploadSessionSize(input.sizeBytes);
      const sourceKind = ['generated','reference_upload','manual_upload','edited','derived'].includes(input.sourceKind) ? input.sourceKind : 'manual_upload';
      const mediaType = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('video/') ? 'video'
        : mimeType.startsWith('audio/') ? 'audio' : mimeType.startsWith('text/') ? 'text'
        : /pdf|document|officedocument|msword/.test(mimeType) ? 'document' : 'other';
      const { workspaceId } = await postgresBilling.getAssetUploadScope(identity.sub);
      const fileToken = crypto.randomUUID();
      const requestedBatchId = String(input.uploadBatchId || '');
      if (!['generated','edited','derived'].includes(sourceKind) && requestedBatchId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedBatchId)) {
        return sendJSON(res, 400, { error: '上传批次编号无效' });
      }
      const editId = sourceKind === 'edited' ? String(input.editId || '') : '';
      const sourceFileId = ['edited','derived'].includes(sourceKind) ? String(input.sourceFileId || '').toLowerCase() : '';
      const previewVariant = sourceKind === 'derived' ? String(input.previewVariant || '') : '';
      const validUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
      if (sourceKind === 'edited' && (!validUuid(editId) || !validUuid(sourceFileId))) return sendJSON(res, 400, { error: '编辑来源记录无效' });
      if (sourceKind === 'derived' && (!validUuid(sourceFileId) || !isAssetPreviewVariant(previewVariant) || mediaType !== 'image')) {
        return sendJSON(res, 400, { error: '预览文件必须是图片，并提供有效的原文件编号和预览规格' });
      }
      const uploadBatchId = ['generated','edited','derived'].includes(sourceKind) ? null : requestedBatchId || crypto.randomUUID();
      const sourceTaskId = sourceKind === 'generated' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(input.sourceGenerationTaskId || ''))
        ? String(input.sourceGenerationTaskId) : '';
      const groupId = sourceTaskId || editId || uploadBatchId || fileToken;
      const now = new Date();
      const extension = path.extname(title).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 16);
      const objectKey = buildAssetObjectKey({ workspaceId, sourceKind, mediaType, createdAt: now, groupingId: groupId, fileId: fileToken, extension, sourceFileId, previewVariant });
      const initialized = await objectStore.multipartInit({ key: objectKey, contentType: mimeType });
      try {
        const session = await postgresBilling.createAssetUploadSession(identity.sub, {
          title, mimeType, sizeBytes, sourceKind, mediaType, objectKey, bucket: initialized.bucket, uploadBatchId, fileId: fileToken,
          providerUploadId: initialized.uploadId, editId, sourceFileId, previewVariant, width: input.width, height: input.height,
          durationMs: input.durationMs, completeness: input.completeness,
          idempotencyKey: input.writeIdempotencyKey,
        });
        return sendJSON(res, 201, { ...session, partSizeBytes: 16 * 1024 * 1024 });
      } catch (error) {
        await objectStore.multipartAbort({ key: objectKey, uploadId: initialized.uploadId }).catch(() => {});
        throw error;
      }
    }
    const uploadSessionMatch = pathname.match(/^\/assets\/upload-sessions\/([0-9a-f-]+)$/i);
    if (uploadSessionMatch && method === 'GET') {
      return sendJSON(res, 200, await postgresBilling.getAssetUploadSession(identity.sub, uploadSessionMatch[1]));
    }
    const uploadPartMatch = pathname.match(/^\/assets\/upload-sessions\/([0-9a-f-]+)\/parts\/([0-9]+)$/i);
    if (uploadPartMatch && method === 'PUT') {
      const session = await postgresBilling.getAssetUploadSession(identity.sub, uploadPartMatch[1]);
      if (session.status !== 'uploading' || session.bucket !== objectStore.getBucket()) return sendJSON(res, 409, { error: '上传会话已失效或不属于当前环境' });
      const partNumber = Number(uploadPartMatch[2]);
      const contentLength = Number(req.headers['content-length']);
      if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000 || !Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > 16 * 1024 * 1024) {
        req.resume();
        return sendJSON(res, 400, { error: '上传分片编号或大小无效' });
      }
      const part = await objectStore.multipartUploadPart({ key: session.objectKey, uploadId: session.providerUploadId, partNumber, body: req, contentLength });
      await postgresBilling.recordAssetUploadPart(identity.sub, session.id, { partNumber, ...part });
      return sendJSON(res, 200, { partNumber, etag: part.etag, sizeBytes: part.sizeBytes });
    }
    const uploadCompleteMatch = pathname.match(/^\/assets\/upload-sessions\/([0-9a-f-]+)\/complete$/i);
    if (uploadCompleteMatch && method === 'POST') {
      const completionInput = await parseBody(req);
      const assetMetadata = completionInput.metadata && typeof completionInput.metadata === 'object' && !Array.isArray(completionInput.metadata)
        ? completionInput.metadata : {};
      const session = await postgresBilling.getAssetUploadSession(identity.sub, uploadCompleteMatch[1]);
      if (session.status === 'completed' && (session.assetId || session.sourceKind === 'derived')) {
        return sendJSON(res, 200, { id: session.sourceKind === 'derived' ? session.fileId : session.assetId,
          name: session.assetTitle || session.originalFilename, type: session.assetType || 'file', favorited: false, derived: session.sourceKind === 'derived' });
      }
      if (!['uploading','completing'].includes(session.status) || session.bucket !== objectStore.getBucket()) return sendJSON(res, 409, { error: '上传会话已失效或不属于当前环境' });
      try {
        const cosParts = session.status === 'uploading'
          ? await objectStore.multipartListParts({ key: session.objectKey, uploadId: session.providerUploadId })
          : session.parts;
        const completion = await postgresBilling.beginAssetUploadCompletion(identity.sub, session.id, cosParts);
        let completed;
        try {
          completed = await objectStore.multipartComplete({ key: session.objectKey, uploadId: session.providerUploadId, parts: completion.parts });
        } catch (completeError) {
          const existing = await objectStore.headObject(session.objectKey).catch(() => null);
          if (!existing || existing.sizeBytes !== completion.sizeBytes) throw completeError;
          completed = { storageVersionId: existing.storageVersionId };
        }
        const mimeType = session.mimeType;
        const assetType = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('video/') ? 'video'
          : mimeType.startsWith('audio/') ? 'audio' : /pdf|document|officedocument|msword/.test(mimeType) ? 'doc' : 'file';
        const asset = await postgresBilling.createAssetFromFile(identity.sub, {
          storageProvider: 'cos', bucket: session.bucket, objectKey: session.objectKey, storageVersionId: completed.storageVersionId,
          checksum: null, sizeBytes: completion.sizeBytes, fileId: session.fileId, workspaceId: session.workspaceId,
          uploadSessionId: session.id, title: session.originalFilename, originalFilename: session.originalFilename,
          assetType, mediaType: session.mediaType, sourceKind: session.sourceKind, mimeType,
          metadata: { ...assetMetadata, sourceKind: session.sourceKind, sourceFileId: session.sourceFileId, previewVariant: session.previewVariant },
        });
        return sendJSON(res, 201, asset);
      } catch (error) {
        try { await postgresBilling.enqueueAssetUploadRecovery(identity.sub, session.id); }
        catch (queueError) { console.error('[assets/upload] recovery enqueue failed', session.id, queueError.message); }
        throw error;
      }
    }
    const uploadAbortMatch = pathname.match(/^\/assets\/upload-sessions\/([0-9a-f-]+)$/i);
    if (uploadAbortMatch && method === 'DELETE') {
      const session = await postgresBilling.getAssetUploadSession(identity.sub, uploadAbortMatch[1]);
      await objectStore.multipartAbort({ key: session.objectKey, uploadId: session.providerUploadId });
      await postgresBilling.failAssetUploadSession(identity.sub, session.id, 'user_aborted');
      return sendJSON(res, 200, { aborted: true });
    }
    const restoreAssetMatch = pathname.match(/^\/assets\/([^/]+)\/restore$/);
    if (restoreAssetMatch && method === 'PUT') {
      return sendJSON(res, 200, await postgresBilling.restoreAsset(identity.sub, restoreAssetMatch[1]));
    }
    const lifecycleAssetMatch = pathname.match(/^\/assets\/([^/]+)$/);
    if (lifecycleAssetMatch && method === 'DELETE') {
      return sendJSON(res, 200, await postgresBilling.deleteAsset(identity.sub, lifecycleAssetMatch[1]));
    }
    const contentMatch = pathname.match(/^\/assets\/([^/]+)\/content$/);
    const readUrlMatch = pathname.match(/^\/assets\/([^/]+)\/read-url$/);
    const derivedContentMatch = pathname.match(/^\/files\/([0-9a-f-]+)\/content$/i);
    if (derivedContentMatch && method === 'GET') {
      const file = await postgresBilling.getDerivedFile(identity.sub, derivedContentMatch[1]);
      if (file.storageProvider !== 'cos' || file.bucket !== objectStore.getBucket()) return sendJSON(res, 404, { error: '预览文件不属于当前环境的云存储' });
      const cdnUrl = objectStore.signCdnReadUrl(file.objectKey);
      if (cdnUrl) {
        res.writeHead(302, { Location: cdnUrl, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
        res.end();
        return true;
      }
      const stored = await objectStore.getObjectStream(file.objectKey, { range: req.headers.range });
      const headers = {
        'Content-Type': file.mimeType || stored.contentType,
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.title)}`,
        'Cache-Control': 'private, max-age=60',
        'Accept-Ranges': 'bytes',
      };
      if (stored.contentLength) headers['Content-Length'] = stored.contentLength;
      if (stored.contentRange) headers['Content-Range'] = stored.contentRange;
      res.writeHead(stored.statusCode === 206 ? 206 : 200, headers);
      stored.stream.on('error', error => { console.error('[files/content]', error.message); res.destroy(error); }).pipe(res);
      return true;
    }
    if (readUrlMatch && method === 'GET') {
      const file = await postgresBilling.getAssetFile(identity.sub, readUrlMatch[1]);
      if (file.storageProvider !== 'cos' || file.bucket !== objectStore.getBucket()) return sendJSON(res, 404, { error: '文件不属于当前环境的云存储' });
      const readUrl = objectStore.signCdnReadUrl(file.objectKey, 300) || await objectStore.signReadUrl(file.objectKey, 300);
      return sendJSON(res, 200, { url: readUrl, mimeType: file.mimeType, expiresInSeconds: 300 });
    }
    if (contentMatch && method === "GET") {
      const file = await postgresBilling.getAssetFile(identity.sub, contentMatch[1]);
      if (file.storageProvider === 'cos') {
        if (file.bucket !== objectStore.getBucket()) return sendJSON(res, 404, { error: '文件不属于当前环境的存储桶' });
        const cdnUrl = objectStore.signCdnReadUrl(file.objectKey);
        if (cdnUrl) {
          res.writeHead(302, { Location: cdnUrl, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
          res.end();
          return true;
        }
        const stored = await objectStore.getObjectStream(file.objectKey, { range: req.headers.range });
        const headers = {
          'Content-Type': file.mimeType || stored.contentType,
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.title)}`,
          'Cache-Control': 'private, max-age=60',
          'Accept-Ranges': 'bytes',
        };
        if (stored.contentLength) headers['Content-Length'] = stored.contentLength;
        if (stored.contentRange) headers['Content-Range'] = stored.contentRange;
        res.writeHead(stored.statusCode === 206 ? 206 : 200, headers);
        stored.stream.on('error', error => { console.error('[assets/content]', error.message); res.destroy(error); }).pipe(res);
      } else if (file.storageProvider === 'local') {
        // 只为读取 COS 接入前已经存在的文件保留兼容；新上传不会再写本地。
        const root = path.resolve(LEGACY_OBJECT_DATA_DIR);
        const filePath = path.resolve(root, file.objectKey);
        if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath)) return sendJSON(res, 404, { error: '文件不存在' });
        const stat = fs.statSync(filePath);
        res.writeHead(200, {
          'Content-Type': file.mimeType,
          'Content-Length': stat.size,
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.title)}`,
          'Cache-Control': 'private, max-age=60',
        });
        fs.createReadStream(filePath).on('error', error => { console.error('[assets/content]', error.message); res.destroy(error); }).pipe(res);
      } else return sendJSON(res, 501, { error: '该文件使用的存储方式不受支持' });
      return true;
    }
    if (pathname === "/assets/upload" && method === "POST") {
      const rawName = String(req.headers["x-asset-name"] || "未命名文件");
      let title = rawName;
      try { title = decodeURIComponent(rawName); } catch { /* 使用原始文件名 */ }
      let metadata = {};
      try {
        const rawMetadata = req.headers["x-asset-metadata"];
        if (rawMetadata) metadata = JSON.parse(decodeURIComponent(String(rawMetadata)));
      } catch { metadata = {}; }
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) metadata = {};
      const requestedBatchId = String(metadata.uploadBatchId || '');
      if (requestedBatchId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedBatchId)) {
        return sendJSON(res, 400, { error: '上传批次编号无效' });
      }
      const assetMetadata = { ...metadata };
      delete assetMetadata.uploadBatchId;
      const mimeType = String(req.headers["content-type"] || "application/octet-stream").split(';')[0];
      const assetType = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('video/') ? 'video' : mimeType.startsWith('audio/') ? 'audio' : mimeType.includes('pdf') || mimeType.includes('document') ? 'doc' : 'file';
      const mediaType = mimeType.startsWith('image/') ? 'images'
        : mimeType.startsWith('video/') ? 'videos'
        : mimeType.startsWith('audio/') ? 'audio'
        : mimeType.startsWith('text/') ? 'text'
        : /pdf|document|officedocument|msword/.test(mimeType) ? 'documents' : 'other';
      const fileMediaType = mediaType === 'images' ? 'image' : mediaType === 'videos' ? 'video'
        : mediaType === 'documents' ? 'document' : ['audio', 'text'].includes(mediaType) ? mediaType : 'other';
      const sourceKind = ['generated', 'reference_upload', 'manual_upload', 'edited', 'derived'].includes(metadata.sourceKind)
        ? metadata.sourceKind : 'manual_upload';
      const extension = path.extname(title).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 16);
      const { workspaceId } = await postgresBilling.getAssetUploadScope(identity.sub);
      const editId = sourceKind === 'edited' ? String(metadata.editId || '') : '';
      const sourceFileId = ['edited', 'derived'].includes(sourceKind) ? String(metadata.sourceFileId || '').toLowerCase() : '';
      const previewVariant = sourceKind === 'derived' ? String(metadata.previewVariant || '') : '';
      const validUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
      if (sourceKind === 'edited' && (!validUuid(editId) || !validUuid(sourceFileId))) return sendJSON(res, 400, { error: '编辑来源记录无效' });
      if (sourceKind === 'derived' && (!validUuid(sourceFileId) || !isAssetPreviewVariant(previewVariant) || fileMediaType !== 'image')) {
        return sendJSON(res, 400, { error: '预览文件必须是图片，并提供有效的原文件编号和预览规格' });
      }
      const uploadBatchId = ['generated','edited','derived'].includes(sourceKind) ? null : requestedBatchId || crypto.randomUUID();
      const fileId = crypto.randomUUID();
      const createdAt = new Date();
      const sourceTaskId = sourceKind === 'generated' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(metadata.sourceGenerationTaskId || ''))
        ? String(metadata.sourceGenerationTaskId) : '';
      const groupId = sourceTaskId || editId || uploadBatchId || fileId;
      const objectKey = buildAssetObjectKey({ workspaceId, sourceKind, mediaType: fileMediaType, createdAt, groupingId: groupId, fileId, extension, sourceFileId, previewVariant });
      const stored = await writeAssetUpload(req, objectStore, objectKey, mimeType);
      try {
        const asset = await postgresBilling.createAssetFromFile(identity.sub, {
          ...stored, fileId, uploadBatchId, workspaceId, title, originalFilename: title, assetType, mediaType: fileMediaType,
          sourceKind, mimeType, checksum: stored.sha256, metadata: assetMetadata, idempotencyKey: assetMetadata.writeIdempotencyKey,
        });
        if (asset.reused && asset.objectKey !== objectKey) {
          try { await objectStore.deleteObject(objectKey); }
          catch (cleanupError) { console.error('[assets/upload] duplicate COS cleanup failed', objectKey, cleanupError.message); }
        }
        return sendJSON(res, 201, asset);
      } catch (error) {
        try { await objectStore.deleteObject(objectKey); }
        catch (cleanupError) { console.error('[assets/upload] COS cleanup failed', objectKey, cleanupError.message); }
        throw error;
      }
    }
    if (pathname === "/assets" && method === "GET") return sendJSON(res, 200, await postgresBilling.listAssets(identity.sub, url.searchParams.get('type') || 'all', url.searchParams.get('keyword') || '', url.searchParams.get('status') || 'active'));
    if (pathname === "/favorites" && method === "GET") return sendJSON(res, 200, await postgresBilling.listFavorites(identity.sub));
    const likeMatch = pathname.match(/^\/assets\/([^/]+)\/like$/);
    if (likeMatch && (method === "PUT" || method === "DELETE")) {
      return sendJSON(res, 200, await postgresBilling.toggleAssetLike(identity.sub, likeMatch[1], method === "PUT"));
    }
    const commentsMatch = pathname.match(/^\/assets\/([^/]+)\/comments$/);
    if (commentsMatch && method === "GET") {
      return sendJSON(res, 200, await postgresBilling.listAssetComments(identity.sub, commentsMatch[1]));
    }
    if (commentsMatch && method === "POST") {
      const body = await parseBody(req);
      return sendJSON(res, 201, await postgresBilling.createAssetComment(identity.sub, commentsMatch[1], body.content, body.parentId || null));
    }
    const match = pathname.match(/^\/favorites\/([^/]+)$/);
    if (match && (method === "PUT" || method === "DELETE")) return sendJSON(res, 200, await postgresBilling.toggleFavorite(identity.sub, match[1], method === "PUT"));
    sendJSON(res, 404, { error: "资产接口不存在" });
    return true;
  } catch (error) {
    console.error("[assets]", error.message);
    sendJSON(res, error.status || 400, { error: error.message || "资产操作失败" });
    return true;
  }
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
async function processGeneratedOutputRecoveryJob(job) {
  try {
    const output = await postgresBilling.getGenerationOutputRecoveryContext(job);
    if (output.task_status !== 'saving' || !output.response_complete || output.availability !== 'awaiting') {
      await postgresBilling.cancelFileUploadRecoveryJob(job);
      return;
    }
    if (output.bucket !== objectStore.getBucket()) throw new Error('生成结果恢复记录与当前存储环境不匹配');

    let stored = null;
    try {
      stored = await objectStore.headObject(output.object_key);
    } catch (error) {
      const code = String(error.code || error.Code || error.statusCode || '');
      if (!['404', 'NoSuchKey', 'NotFound', 'NotFoundException'].includes(code)) throw error;
    }

    let saved;
    if (stored && stored.sizeBytes > 0 && (output.size_bytes == null || Number(output.size_bytes) === stored.sizeBytes)) {
      saved = stored;
    } else if (output.recoveryUrl) {
      const source = await fetchUrlAsStream(output.recoveryUrl);
      const { prefix, body } = await peekStreamPrefix(source.body);
      const mime = sniffGeneratedMediaMime(output.output_type || 'image', prefix, source.contentType);
      saved = await objectStore.putObject({ key: output.object_key, body, contentLength: source.contentLength, contentType: mime, preserveOnError: true });
    } else {
      const result = await postgresBilling.failGeneratedOutputRecoveryJob(job, 'base64_source_unavailable', 1);
      console.error('[generation-recovery] source unavailable', job.id, result.status);
      return;
    }

    const completed = await postgresBilling.finishGeneratedOutputRecoveryJob(job, saved);
    await postgresBilling.settleGenerationTaskIfComplete(job.appwriteUserId, completed.taskId);
    console.log('[generation-recovery] completed', job.id, completed.outputId);
  } catch (error) {
    try {
      const result = await postgresBilling.failGeneratedOutputRecoveryJob(job, error.code || 'persist_failed');
      console.error('[generation-recovery] retry scheduled', job.id, result.status, error.message);
    } catch (leaseError) {
      console.error('[generation-recovery] lease lost', job.id, leaseError.message);
    }
  }
}

async function processFileUploadRecoveryJob(job) {
  if (job.generationOutputId) return processGeneratedOutputRecoveryJob(job);
  try {
    const session = await postgresBilling.getAssetUploadSession(job.appwriteUserId, job.uploadSessionId);
    if (session.status === 'completed' && (session.assetId || session.sourceKind === 'derived')) {
      await postgresBilling.finishFileUploadRecoveryJob(job);
      return;
    }
    if (['aborted', 'failed'].includes(session.status)) {
      await postgresBilling.cancelFileUploadRecoveryJob(job);
      console.log('[file-recovery] cancelled terminal upload', job.id, session.status);
      return;
    }
    if (session.status !== 'completing' || session.bucket !== objectStore.getBucket()) throw new Error('上传会话状态或存储桶不匹配');

    let completed = await objectStore.headObject(session.objectKey).catch(() => null);
    if (!completed || completed.sizeBytes !== session.sizeBytes) {
      const cosParts = await objectStore.multipartListParts({ key: session.objectKey, uploadId: session.providerUploadId });
      const completion = await postgresBilling.beginAssetUploadCompletion(job.appwriteUserId, session.id, cosParts);
      try {
        completed = await objectStore.multipartComplete({ key: session.objectKey, uploadId: session.providerUploadId, parts: completion.parts });
      } catch (error) {
        const existing = await objectStore.headObject(session.objectKey).catch(() => null);
        if (!existing || existing.sizeBytes !== completion.sizeBytes) throw error;
        completed = existing;
      }
    }
    const mimeType = session.mimeType || 'application/octet-stream';
    const assetType = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('video/') ? 'video'
      : mimeType.startsWith('audio/') ? 'audio' : /pdf|document|officedocument|msword/.test(mimeType) ? 'doc' : 'file';
    await postgresBilling.createAssetFromFile(job.appwriteUserId, {
      storageProvider: 'cos', bucket: session.bucket, objectKey: session.objectKey,
      storageVersionId: completed.storageVersionId || null, checksum: null, sizeBytes: session.sizeBytes,
      fileId: session.fileId, workspaceId: session.workspaceId, uploadSessionId: session.id,
      title: session.originalFilename, originalFilename: session.originalFilename, assetType,
      mediaType: session.mediaType, sourceKind: session.sourceKind,
      metadata: { sourceKind: session.sourceKind, width: session.width, height: session.height,
        durationMs: session.durationMs, completeness: session.completeness,
        editId: session.editId, sourceFileId: session.sourceFileId, previewVariant: session.previewVariant },
      idempotencyKey: session.writeIdempotencyKey,
    });
    await postgresBilling.finishFileUploadRecoveryJob(job);
    console.log('[file-recovery] completed', job.id, session.fileId);
  } catch (error) {
    try {
      const result = await postgresBilling.retryFileUploadRecoveryJob(job, error.code || 'persist_failed');
      console.error('[file-recovery] retry scheduled', job.id, result.status, error.message);
    } catch (leaseError) {
      console.error('[file-recovery] lease lost', job.id, leaseError.message);
    }
  }
}

const server = http.createServer(async (req, res) => {
  applyCors(req, res);
  // Cookie 会随浏览器请求自动携带；对写操作验证来源，避免第三方页面借用登录态。
  if (isUnsafeMethod(req.method) && readCookie(req, CUSTOMER_SESSION_COOKIE) && !hasTrustedMutationOrigin(req)) {
    return sendJSON(res, 403, { error: "请求来源不受信任，请刷新页面后重试" });
  }
  // CORS 预检
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...(res.getHeader("Access-Control-Allow-Origin") ? { "Access-Control-Allow-Origin": res.getHeader("Access-Control-Allow-Origin") } : {}),
      "Access-Control-Allow-Headers": res.getHeader("Access-Control-Allow-Headers") || "Content-Type, Authorization, X-Qingyu-Requested-With",
      "Access-Control-Allow-Methods": res.getHeader("Access-Control-Allow-Methods") || "GET, POST, PUT, DELETE, OPTIONS",
      ...(res.getHeader("Access-Control-Allow-Credentials") ? { "Access-Control-Allow-Credentials": res.getHeader("Access-Control-Allow-Credentials") } : {}),
      ...(res.getHeader("Vary") ? { Vary: res.getHeader("Vary") } : {}),
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    // POST /api/payment/webhooks/:provider — 只接收经过 HMAC 校验的供应商事件，收到不等于已入账
    const paymentWebhookMatch = pathname.match(/^\/api\/payment\/webhooks\/([A-Za-z0-9_-]+)$/);
    if (paymentWebhookMatch && req.method === 'POST') {
      const secret = String(process.env.PAYMENT_WEBHOOK_SECRET || '');
      if (!secret) return sendJSON(res, 503, { error: '支付回调尚未配置服务端密钥' });
      const raw = await parseRawBody(req);
      const signature = String(req.headers['x-payment-signature'] || '');
      const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
      const signatureBytes = Buffer.from(signature); const expectedBytes = Buffer.from(expected);
      if (!signature || signatureBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(signatureBytes, expectedBytes)) return sendJSON(res, 401, { error: '支付回调签名无效' });
      let event; try { event = JSON.parse(raw.toString('utf8')); } catch { return sendJSON(res, 400, { error: '支付回调 JSON 无效' }); }
      if (!postgresBilling) return sendJSON(res, 503, { error: '计费数据库暂不可用' });
      return sendJSON(res, 202, await postgresBilling.recordPaymentEvent(paymentWebhookMatch[1], event));
    }

    // ===== 公开接口（无需认证）=====

    // GET /api/config/public — 公开模型配置
    if (pathname === "/api/config/public" && req.method === "GET") {
      const identity = getBillingIdentity(req);
      if (!identity || identity.role !== "customer") return sendJSON(res, 401, { error: "未登录或登录已过期" });
      if (req.headers["x-qingyu-client"] !== "web") return sendJSON(res, 403, { error: "forbidden" });
      if (postgresBilling) return sendJSON(res, 200, await postgresBilling.listPublicModelCatalogChannels());
      const catalogConfigs = modelsCatalog.filter(model => model.visible !== false).flatMap(model => {
        const links = (model.linkedModels || []).filter(link => link.isActive !== false)
          .map(link => ({ link, channel: keys.find(key => String(key.id) === String(link.channelId) && key.is_active === 1) }))
          .filter(entry => entry.channel);
        if (!links.length) return [];
        const provider = String(links[0].channel.provider).toLowerCase() === "gemini" ? "gemini" : "openai";
        const modelName = `catalog:${model.id}`;
        // 与数据库分支保持一致，只返回协议占位地址，不下发真实渠道地址。
        const baseUrl = provider === "gemini" ? "https://generativelanguage.googleapis.com" : "https://api.openai.com";
        return [{ id: `catalog-${model.id}`, name: model.displayName, provider, base_url: baseUrl, model: modelName, models: [{ name: modelName, displayName: model.displayName, capability: model.capability }] }];
      });
      return sendJSON(res, 200, catalogConfigs);
    }

    // POST /api/feedback — 反馈允许匿名提交，但必须进入 PostgreSQL；数据库不可用时明确失败。
    if (pathname === "/api/feedback" && req.method === "POST") {
      if (!postgresBilling) return sendJSON(res, 503, { error: "反馈服务暂不可用，请稍后重试" });
      const body = await parseBody(req);
      const identity = getBillingIdentity(req);
      try {
        const saved = await postgresBilling.createFeedback({
          appwriteUserId: identity?.role === "customer" ? identity.sub : null,
          feedbackType: body.type,
          content: body.content,
          contact: body.contact,
          requestId: req.headers["x-request-id"] || crypto.randomUUID(),
        });
        return sendJSON(res, 201, saved);
      } catch (error) {
        return sendJSON(res, 400, { error: error.message || "反馈保存失败，请稍后重试" });
      }
    }

    // ===== AI 对话：对话与消息 CRUD =====
    const chatConvMatch = pathname.match(/^\/api\/chat\/conversations(?:\/([A-Za-z0-9-]+))?(?:\/messages)?$/);
    if (chatConvMatch && (req.method === "GET" || req.method === "POST" || req.method === "PATCH" || req.method === "DELETE")) {
      if (!postgresBilling) return sendJSON(res, 503, { error: "对话服务暂不可用" });
      const identity = getBillingIdentity(req);
      if (!identity || identity.role !== "customer") return sendJSON(res, 401, { error: "请先登录后再使用对话" });
      if (!(await postgresBilling.isSessionActive(identity.sub, identity.sid || ""))) return sendJSON(res, 401, { error: "当前登录设备已离线，请重新登录" });
      const convId = chatConvMatch[1];
      const isMessagesSubpath = /\/messages$/.test(pathname);

      // GET /api/chat/conversations — 列对话
      if (!convId && req.method === "GET") {
        return sendJSON(res, 200, { conversations: await postgresBilling.listChatConversations(identity.sub) });
      }
      // POST /api/chat/conversations — 建对话
      if (!convId && req.method === "POST") {
        const body = await parseBody(req);
        return sendJSON(res, 201, await postgresBilling.createChatConversation(identity.sub, body || {}));
      }
      if (!convId) return sendJSON(res, 404, { error: "not found" });

      // GET /api/chat/conversations/:id/messages — 拉消息
      if (isMessagesSubpath && req.method === "GET") {
        const msgs = await postgresBilling.listChatMessages(identity.sub, convId);
        if (!msgs) return sendJSON(res, 404, { error: "对话不存在" });
        return sendJSON(res, 200, { messages: msgs });
      }
      // POST /api/chat/conversations/:id/messages — 追加一条消息
      if (isMessagesSubpath && req.method === "POST") {
        const body = await parseBody(req);
        try {
          const saved = await postgresBilling.appendChatMessage(identity.sub, convId, {
            role: body.role, content: body.content,
            tokensIn: body.tokensIn, tokensOut: body.tokensOut, status: body.status,
          });
          return sendJSON(res, 201, saved);
        } catch (e) { return sendJSON(res, 400, { error: e.message }); }
      }
      if (isMessagesSubpath) return sendJSON(res, 405, { error: "method not allowed" });

      // GET /api/chat/conversations/:id — 对话详情
      if (req.method === "GET") {
        const conv = await postgresBilling.getChatConversation(identity.sub, convId);
        if (!conv) return sendJSON(res, 404, { error: "对话不存在" });
        return sendJSON(res, 200, { conversation: conv });
      }
      // PATCH /api/chat/conversations/:id — 改标题/设置
      if (req.method === "PATCH") {
        const body = await parseBody(req);
        try {
          return sendJSON(res, 200, await postgresBilling.updateChatConversation(identity.sub, convId, body || {}));
        } catch (e) { return sendJSON(res, 400, { error: e.message }); }
      }
      // DELETE /api/chat/conversations/:id — 删对话
      if (req.method === "DELETE") {
        try {
          return sendJSON(res, 200, await postgresBilling.deleteChatConversation(identity.sub, convId));
        } catch (e) { return sendJSON(res, 400, { error: e.message }); }
      }
      return sendJSON(res, 405, { error: "method not allowed" });
    }
    // POST /api/proxy/openai/* — AI 请求代理
    if (pathname.startsWith("/api/proxy/openai/") && req.method === "POST") {
      const targetPath = pathname.replace("/api/proxy/openai", "");
      return proxyRequest(req, res, targetPath);
    }

    // ===== 异步生图与媒体任务：提交即返回 task_id，后台执行并保存到 COS =====
    // ===== 本地开发专用：一键登录 =====
    // 仅允许本地开发环境使用；Vite 只为本机浏览器请求添加专用标记，API 端口也仅绑定本机。
    // 访问 http://localhost:5173/dev-login 自动签发本地开发会话。
    if (pathname === "/api/dev-login" && req.method === "GET") {
      const trustedLocalDevRequest = req.headers["x-qingyu-local-dev-login"] === "1";
      if (process.env.DEV_LOGIN !== "1" || process.env.NODE_ENV === "production" || !trustedLocalDevRequest) {
        return sendJSON(res, 404, { error: "not found" });
      }
      if (!postgresBilling) return sendJSON(res, 503, { error: "db not ready" });
      const uid = url.searchParams.get("user") || "local-dev-user";
      const email = url.searchParams.get("email") || `${uid}@local.dev`;
      try {
        const user = await postgresBilling.ensureUser(uid, email, "", new Date().toISOString());
        const session = await postgresBilling.registerSession(uid, {
          clientType: "dev-login",
          installationId: url.searchParams.get("installationId") || "",
        });
        const exp = Math.floor(Date.now() / 1000) + CUSTOMER_SESSION_MAX_AGE_SECONDS;
        const token = signJWT({ sub: uid, role: "customer", sid: session.id, iat: Math.floor(Date.now()/1000), exp });
        const cookieHeaders = { "Set-Cookie": customerSessionCookie(token) };
        // JSON 模式：浏览器自动保存 HttpOnly Cookie，页面脚本不接触登录票。
        if (url.searchParams.get("format") === "json" || (req.headers.accept || "").includes("application/json")) {
          return sendJSON(res, 200, { uid, email: user.email }, cookieHeaders);
}

        // 返回一个只写非敏感演示身份状态并跳转的 HTML 页；登录票由响应头保存。
        // zustand persist 的 auth-store 也要写，否则 checkSession 会强制查 Appwrite 把登录态清掉。
        const authStoreState = {
          state: {
            user: { id: uid, email: user.email, name: uid, emailVerified: true, createdAt: new Date().toISOString() },
            isLoggedIn: true,
            teams: [],
            currentTeam: null,
          },
          version: 0,
        };
        const html = `<!doctype html><meta charset="utf-8"><title>dev login</title>
<body style="background:#111;color:#eee;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div>登录中... <script>
localStorage.setItem('appwrite_uid', ${JSON.stringify(uid)});
localStorage.setItem('billing_token_user', ${JSON.stringify(uid)});
localStorage.setItem('auth-store', ${JSON.stringify(JSON.stringify(authStoreState))});
localStorage.setItem('dev_login', '1');
localStorage.setItem('infinite-canvas:locale', 'zh-CN');
localStorage.removeItem('infinite-canvas:locale-manual');
location.href = 'http://localhost:5173/';
</script></div></body>`;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...cookieHeaders });
        res.end(html);
        return;
      } catch (e) {
        return sendJSON(res, 500, { error: e.message });
      }
    }
    if (pathname === "/api/generation-tasks/media" && req.method === "POST") {
      if (!postgresBilling) return sendJSON(res, 503, { error: "计费数据库暂不可用" });
      const identity = getBillingIdentity(req);
      if (!identity || identity.role !== "customer") return sendJSON(res, 401, { error: "请先登录后再使用 AI 服务" });
      if (!(await postgresBilling.isSessionActive(identity.sub, identity.sid || ""))) return sendJSON(res, 401, { error: "当前登录设备已离线，请重新登录" });
      const body = await parseBody(req);
      const taskType = String(body.taskType || '').toLowerCase();
      if (!['video','audio'].includes(taskType)) return sendJSON(res, 400, { error: '只支持视频或音频任务' });
      const modelField = String(body.model || '');
      const match = await findChannelForModel(modelField);
      if (!match || String(match.channel.provider || '').toLowerCase() === 'gemini') return sendJSON(res, 400, { error: '当前媒体模型渠道暂不支持服务器恢复' });
      const params = body.parameters && typeof body.parameters === 'object' ? body.parameters : {};
      const parameters = taskType === 'video' ? {
        duration: Math.max(1, Math.min(120, Number(params.duration) || 6)),
        ratio: String(params.ratio || '16:9').slice(0, 16),
        resolution: String(params.resolution || '720').slice(0, 24),
        generateAudio: params.generateAudio !== false,
        watermark: params.watermark === true,
        mode: params.mode === 'reference' ? 'reference' : 'frames',
      } : {
        voice: String(params.voice || 'alloy').slice(0, 80),
        format: String(params.format || 'mp3').toLowerCase().slice(0, 16),
        speed: Math.max(0.25, Math.min(4, Number(params.speed) || 1)),
        instructions: String(params.instructions || '').slice(0, 4000),
      };
      const references = Array.isArray(body.referenceAssetIds) ? body.referenceAssetIds : [];
      const idempotencyKey = String(body.idempotencyKey || req.headers['idempotency-key'] || '').trim() || `${taskType}-task:${crypto.randomUUID()}`;
      try {
        const task = await postgresBilling.createGenerationTask(identity.sub, {
          taskType, provider: match.channel.provider, model: match.model, modelCatalogId: match.catalogModelId,
          prompt: String(body.prompt || '').slice(0, 4000), parameters, quantity: 1,
          idempotencyKey, referenceAssetIds: references, timeoutSeconds: 1800, creditQuoteId: body.creditQuoteId,
        });
        setImmediate(() => runGenerationTaskMediaWorker(identity, task, match.channel, parameters));
        return sendJSON(res, 202, { taskId: task.id, status: task.status });
      } catch (error) {
        if (/积分|额度|余额|quota|insufficient|daily/i.test(String(error.message || ''))) return sendJSON(res, 402, { error: error.message });
        if (/参考素材编号|参考素材不存在|参考素材不能|同一任务编号不能/.test(String(error.message || ''))) return sendJSON(res, 400, { error: error.message });
        console.error('[media-task] create failed', error.message);
        return sendJSON(res, 500, { error: '媒体生成任务创建失败，请稍后重试' });
      }
    }
    if (pathname === "/api/generation-tasks" && req.method === "POST") {
      if (!postgresBilling) return sendJSON(res, 503, { error: "计费数据库暂不可用" });
      const identity = getBillingIdentity(req);
      if (!identity || identity.role !== "customer") return sendJSON(res, 401, { error: "请先登录后再使用 AI 服务" });
      if (!(await postgresBilling.isSessionActive(identity.sub, identity.sid || ""))) return sendJSON(res, 401, { error: "当前登录设备已离线，请重新登录" });
      const body = await parseBody(req);
      const modelField = String(body.model || "");
      const match = await findChannelForModel(modelField);
      if (!match) return sendJSON(res, 502, { error: "当前模型暂不可用，请稍后再试" });
      const channel = match.channel;
      const bodyObj = { ...body };
      const referenceAssetIds = Array.isArray(bodyObj.referenceAssetIds) ? bodyObj.referenceAssetIds : [];
      const creditQuoteId = bodyObj.creditQuoteId;
      const idempotencyKey = String(bodyObj.idempotencyKey || req.headers['idempotency-key'] || '').trim() || `image-task:${crypto.randomUUID()}`;
      delete bodyObj.idempotencyKey; delete bodyObj.quantity; delete bodyObj.timeoutSeconds; delete bodyObj.referenceAssetIds; delete bodyObj.creditQuoteId;
      if (modelField.includes("::") || match.catalogModelId) bodyObj.model = match.model;
      if (match.catalogModelId) bodyObj.__qingyuCatalogModelId = match.catalogModelId;
      bodyObj.response_format = bodyObj.response_format || "b64_json";
      const quantity = Math.max(1, Math.min(15, Number(bodyObj.n) || 1));
      try {
        const task = await postgresBilling.createGenerationTask(identity.sub, {
           taskType: "image", provider: channel.provider, model: match.model, modelCatalogId: match.catalogModelId,
           prompt: String(bodyObj.prompt || "").slice(0, 4000), parameters: bodyObj, quantity,
           idempotencyKey, referenceAssetIds, creditQuoteId,
           timeoutSeconds: 600,
        });
        // 立即返回，不等待上游；后台异步执行避免请求超时导致状态不确定。
        setImmediate(() => runGenerationTaskWorker(identity, task, channel, bodyObj));
        return sendJSON(res, 202, { taskId: task.id, status: task.status });
      } catch (e) {
        if (/积分|额度|余额|quota|insufficient|daily/i.test(String(e.message || ""))) return sendJSON(res, 402, { error: e.message });
        if (/参考素材编号|参考素材不存在|参考素材不能|同一任务编号不能/.test(String(e.message || ""))) {
          const conflict = String(e.message || "").includes('同一任务编号');
          return sendJSON(res, conflict ? 409 : 400, { error: e.message });
        }
        console.error("[generation-task] create failed", e);
        return sendJSON(res, 500, { error: "生成失败，请稍后重试" });
      }
    }
    if (pathname === "/api/generation-tasks" && req.method === "GET") {
      if (!postgresBilling) return sendJSON(res, 503, { error: "计费数据库暂不可用" });
      const identity = getBillingIdentity(req);
      if (!identity || identity.role !== "customer") return sendJSON(res, 401, { error: "请先登录" });
      if (!(await postgresBilling.isSessionActive(identity.sub, identity.sid))) return sendJSON(res, 401, { error: "当前登录设备已离线，请重新登录" });
      return sendJSON(res, 200, await postgresBilling.listMyGenerationTasks(identity.sub, 50));
    }
    const taskMatch = pathname.match(/^\/api\/generation-tasks\/([^/]+)$/);
    if (taskMatch && req.method === "GET") {
      if (!postgresBilling) return sendJSON(res, 503, { error: "计费数据库暂不可用" });
      const identity = getBillingIdentity(req);
      if (!identity || identity.role !== "customer") return sendJSON(res, 401, { error: "请先登录" });
      if (!(await postgresBilling.isSessionActive(identity.sub, identity.sid))) return sendJSON(res, 401, { error: "当前登录设备已离线，请重新登录" });
      try { return sendJSON(res, 200, await postgresBilling.getGenerationTask(identity.sub, taskMatch[1])); }
      catch (e) { return sendJSON(res, 404, { error: e.message }); }
    }
    // GET /api/generation-tasks/:id/outputs/:index/content — 流式返回生图结果文件。
    // 私有权限：必须登录且任务属于当前用户；后端校验通过后才从对象存储读流回。
    const outputMatch = pathname.match(/^\/api\/generation-tasks\/([^/]+)\/outputs\/(\d+)\/content$/);
    if (outputMatch && req.method === "GET") {
      // 图片和 API 同源，浏览器会自动携带 HttpOnly Cookie；禁止把登录票放进网址。
      const identity = getBillingIdentity(req);
      if (!identity || identity.role !== "customer") return sendJSON(res, 401, { error: "请先登录" });
      if (!postgresBilling) return sendJSON(res, 503, { error: "计费数据库暂不可用" });
      if (!(await postgresBilling.isSessionActive(identity.sub, identity.sid))) return sendJSON(res, 401, { error: "当前登录设备已离线，请重新登录" });
      const taskId = outputMatch[1];
      const wantIndex = parseInt(outputMatch[2], 10);
      try {
        const outputs = await postgresBilling.listGeneratedOutputs(identity.sub, taskId);
        const found = outputs.find(o => o.index === wantIndex)
                   || (wantIndex === 0 ? outputs[0] : null);
        if (!found) return sendJSON(res, 404, { error: "生成结果不存在" });
        if (found.storageProvider === 'cos') {
          if (found.bucket !== objectStore.getBucket()) return sendJSON(res, 404, { error: '图片不属于当前环境的存储桶' });
          const cdnUrl = objectStore.signCdnReadUrl(found.objectKey);
          if (cdnUrl) {
            res.writeHead(302, { Location: cdnUrl, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
            res.end();
            return;
          }
          const stored = await objectStore.getObjectStream(found.objectKey, { range: req.headers.range });
          const headers = {
            'Content-Type': found.contentType || stored.contentType || 'application/octet-stream',
            'Cache-Control': 'private, max-age=31536000, immutable',
            'Accept-Ranges': 'bytes',
          };
          const size = stored.contentLength || found.sizeBytes;
          if (size) headers['Content-Length'] = size;
          if (stored.contentRange) headers['Content-Range'] = stored.contentRange;
          res.writeHead(stored.statusCode === 206 ? 206 : 200, headers);
          stored.stream.on('error', error => { console.error('[generation-output/content]', error.message); res.destroy(error); }).pipe(res);
        } else if (found.storageProvider === 'local') {
          // 只为读取 COS 接入前已经存在的结果保留兼容；新结果不会再写本地。
          const root = path.resolve(LEGACY_OBJECT_DATA_DIR);
          const filePath = path.resolve(root, found.objectKey);
          if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath)) return sendJSON(res, 404, { error: '生成结果文件已失效' });
          const stat = fs.statSync(filePath);
          res.writeHead(200, {
            'Content-Type': found.contentType || 'application/octet-stream',
            'Content-Length': stat.size,
            'Cache-Control': 'private, max-age=31536000, immutable',
          });
          fs.createReadStream(filePath).on('error', error => { console.error('[generation-output/content]', error.message); res.destroy(error); }).pipe(res);
        } else return sendJSON(res, 501, { error: '该生成结果使用的存储方式不受支持' });
        return;
      } catch (e) {
        return sendJSON(res, 404, { error: e.message });
      }
    }

    // POST /api/admin/login — 管理员登录
    if (pathname === "/api/admin/login" && req.method === "POST") {
      const body = await parseBody(req);
      if (!body || typeof body.username !== "string" || !body.username.trim() || body.username.trim().length > 64
        || body.username.length > 200
        || typeof body.password !== "string" || body.password.length > 1024) {
        return sendJSON(res, 400, { error: "请输入有效的用户名和密码" });
      }
      const attempt = postgresBilling
        ? await postgresBilling.reserveAdminLoginAttempt(body.username)
        : reserveAdminLoginAttempt(body.username);
      if (attempt.retryAfter) {
        return sendJSON(res, 429, { error: "登录尝试过于频繁，请稍后再试" }, { "Retry-After": String(attempt.retryAfter) });
      }
      const account = postgresBilling
        ? await postgresBilling.getAdminAccount(body.username)
        : (body.username === admin.username ? admin : null);
      let accountPasswordHash = account?.password_hash || account?.password;
      if (account && (account.status || "active") === "active" && await verifyAdminPassword(body.password, accountPasswordHash)) {
        if (postgresBilling) {
          const touched = await postgresBilling.touchAdminLogin(account.username);
          if (!touched || !await verifyAdminPassword(body.password, touched.password_hash)) {
            return sendJSON(res, 401, { error: "用户名或密码错误" });
          }
          accountPasswordHash = touched.password_hash;
        }
        if (needsAdminPasswordRehash(accountPasswordHash)) {
          const upgradedHash = await hashPassword(body.password);
          if (postgresBilling) {
            const upgraded = await postgresBilling.upgradeAdminPasswordHash(account.username, accountPasswordHash, upgradedHash);
            if (!upgraded) {
              const latest = await postgresBilling.getAdminAccount(account.username);
              if (!latest || (latest.status || "active") !== "active" || !await verifyAdminPassword(body.password, latest.password_hash)) {
                return sendJSON(res, 401, { error: "用户名或密码错误" });
              }
            }
          } else if (admin.password === accountPasswordHash) {
            admin.password = upgradedHash;
            saveJSON(ADMIN_FILE, admin);
          } else if (!await verifyAdminPassword(body.password, admin.password)) {
            return sendJSON(res, 401, { error: "用户名或密码错误" });
          }
        }
        if (postgresBilling) await postgresBilling.clearAdminLoginAttempts(body.username);
        else adminLoginAttempts.delete(attempt.key);
        const exp = Math.floor(Date.now() / 1000) + 24 * 60 * 60; // 24h
        const token = signJWT({ sub: account.username, role: "admin", iat: Math.floor(Date.now() / 1000), exp });
        return sendJSON(res, 200, { token });
      }
      return sendJSON(res, 401, { error: "用户名或密码错误" });
    }

    // GET /api/admin/monitor/metrics — 管理端读取当前服务实际指标，禁止返回演示数据。
    if (pathname === "/api/admin/monitor/metrics" && req.method === "GET") {
      const identity = getBillingIdentity(req);
      if (!identity || identity.role !== "admin") return sendJSON(res, 403, { error: "无管理员权限" });
      let disk = null;
      try {
        const stat = fs.statfsSync(DATA_DIR);
        const total = Number(stat.blocks) * Number(stat.bsize);
        const available = Number(stat.bavail) * Number(stat.bsize);
        disk = { totalBytes: total, usedBytes: Math.max(0, total - available), availableBytes: available };
      } catch { /* 某些系统不支持 statfs 时保留为空，不伪造磁盘数值。 */ }
      const memory = process.memoryUsage();
      return sendJSON(res, 200, {
        sampledAt: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        cpu: { load1: os.loadavg()[0] ?? null, cores: os.cpus().length },
        memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal },
        disk,
        database: { billingStore: postgresBilling ? "postgres" : "disabled" },
      });
    }

    // 设备管理是离线设备的保留入口：离线设备不能使用业务功能，但仍要能查看设备状态、踢出设备。
    // 这样“同时登录、只有一台在线”的规则不会把用户锁在无法自助恢复的状态里。
    if (postgresBilling && (pathname === "/api/account/sessions" || pathname.startsWith("/api/account/sessions/"))) {
      const identity = getBillingIdentity(req);
      if (!identity || identity.role !== "customer") return sendJSON(res, 401, { error: "未登录或登录已过期" });
      try {
        if (!(await postgresBilling.isSessionAdmitted(identity.sub, identity.sid))) return sendJSON(res, 401, { error: "当前设备登录已撤销或过期，请重新登录" });
        if (pathname === "/api/account/sessions" && req.method === "GET") return sendJSON(res, 200, await postgresBilling.listSessions(identity.sub));
        const sessionMatch = pathname.match(/^\/api\/account\/sessions\/([^/]+)$/);
        if (sessionMatch && req.method === "DELETE") {
          const result = await postgresBilling.revokeSession(identity.sub, sessionMatch[1]);
          return sendJSON(res, 200, result, sessionMatch[1] === identity.sid ? { "Set-Cookie": clearCustomerSessionCookie() } : {});
        }
        return sendJSON(res, 404, { error: "会话接口不存在" });
      } catch (error) { return sendJSON(res, 400, { error: error.message || "会话操作失败" }); }
    }

    // 新版业务 Token 带数据库会话编号；会话被撤销或被另一台设备接管后，业务请求立即拒绝。
    const requestIdentity = getBillingIdentity(req);
    const authenticationPath = (pathname === "/api/billing/logout" || pathname === "/api/billing/login") && req.method === "POST";
    if (!authenticationPath && requestIdentity?.role === "customer") {
      if (!postgresBilling && !(process.env.NODE_ENV === "test" && PAYMENT_MODE === "mock")) {
        return sendJSON(res, 503, { error: "登录会话服务暂不可用" });
      }
      if (postgresBilling && !(await postgresBilling.isSessionActive(requestIdentity.sub, requestIdentity.sid))) {
        return sendJSON(res, 401, { error: "当前设备处于离线状态，请在本设备重新登录后接管在线状态" });
      }
    }
    const outputAssetMatch = pathname.match(/^\/api\/generation-tasks\/([^/]+)\/outputs\/(\d+)\/asset$/);
    if (outputAssetMatch && req.method === 'POST') {
      const identity = getBillingIdentity(req);
      if (!identity || identity.role !== 'customer') return sendJSON(res, 401, { error: '请先登录' });
      if (!postgresBilling) return sendJSON(res, 503, { error: '计费数据库暂不可用' });
      if (!(await postgresBilling.isSessionActive(identity.sub, identity.sid))) return sendJSON(res, 401, { error: '当前登录设备已离线，请重新登录' });
      try {
        const body = await parseBody(req);
        const task = await postgresBilling.getGenerationTask(identity.sub, outputAssetMatch[1]);
        if (task.status !== 'succeeded' || !['video','audio'].includes(task.taskType)) return sendJSON(res, 409, { error: '媒体结果尚未完成或类型不支持' });
        const asset = await postgresBilling.createAssetFromGeneratedOutput(identity.sub, task.id, Number(outputAssetMatch[2]), body.title || `${task.taskType === 'video' ? '生成视频' : '生成音频'}`, body.metadata || {});
        return sendJSON(res, 200, asset);
      } catch (error) { return sendJSON(res, 400, { error: error.message || '生成结果登记失败' }); }
    }

    // ===== 计费系统路由（客户 + 管理端计费）===== 
    if (await handleBilling(req, res, pathname, req.method, url)) {
      return;
    }

    // ===== 团队路由（客户身份，数据来自 PostgreSQL）=====
    if (await handleTeams(req, res, pathname, req.method)) {
      return;
    }

    if (postgresBilling && (pathname === "/api/sync/events" || pathname === "/api/sync/cursor")) {
      const identity = getBillingIdentity(req);
      if (!identity || identity.role !== "customer") return sendJSON(res, 401, { error: "未登录或登录已过期" });
      try {
        if (pathname === "/api/sync/events" && req.method === "GET") {
          const workspaceId = url.searchParams.get("workspaceId") || "";
          const after = url.searchParams.get("after") || "0";
          return sendJSON(res, 200, await postgresBilling.listSyncEvents(identity.sub, workspaceId, after, url.searchParams.get("limit") || "100"));
        }
        if (pathname === "/api/sync/cursor" && req.method === "POST") {
          const body = await parseBody(req);
          return sendJSON(res, 200, await postgresBilling.ackSyncCursor(identity.sub, body.deviceId, body.workspaceId, body.lastSequence));
        }
        return sendJSON(res, 404, { error: "同步接口不存在" });
      } catch (error) { return sendJSON(res, 400, { error: error.message || "同步操作失败" }); }
    }

    if (postgresBilling && (pathname === "/api/canvas/projects" || pathname === "/api/canvas/projects/snapshot")) {
      const identity = getBillingIdentity(req);
      if (!identity || identity.role !== "customer") return sendJSON(res, 401, { error: "未登录或登录已过期" });
      try {
        if (pathname === "/api/canvas/projects" && req.method === "GET") return sendJSON(res, 200, await postgresBilling.listCanvasSnapshots(identity.sub));
        if (pathname === "/api/canvas/projects/snapshot" && req.method === "POST") return sendJSON(res, 200, await postgresBilling.saveCanvasSnapshot(identity.sub, await parseBody(req)));
        return sendJSON(res, 404, { error: "画布接口不存在" });
      } catch (error) {
        if (error.code === 'VERSION_CONFLICT') return sendJSON(res, 409, { code: error.code, error: error.message || "画布版本冲突", conflicts: error.conflicts || [] });
        return sendJSON(res, 400, { error: error.message || "画布保存失败" });
      }
    }

    if (postgresBilling && pathname === "/api/agent/snapshot" && req.method === "POST") {
      const identity = getBillingIdentity(req);
      if (!identity || identity.role !== "customer") return sendJSON(res, 401, { error: "未登录或登录已过期" });
      try { return sendJSON(res, 200, await postgresBilling.saveAgentSnapshot(identity.sub, await parseBody(req))); }
      catch (error) { return sendJSON(res, 400, { error: error.message || "Agent 记录保存失败" }); }
    }

    if (await handleAssets(req, res, pathname, req.method, url)) {
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
      if (payload.role !== "admin") {
        return sendJSON(res, 403, { error: "无管理员权限" });
      }
    }

    // ===== 管理员：对账、异常告警（0046） =====
    if (postgresBilling && pathname === "/api/admin/billing/reconciliation" && req.method === "GET") {
      return sendJSON(res, 200, await postgresBilling.adminReconciliation());
    }
    if (postgresBilling && pathname === "/api/admin/billing/alerts" && req.method === "GET") {
      const all = url.searchParams.get("all") === "1";
      return sendJSON(res, 200, await postgresBilling.listAlerts(!all));
    }
    const alertAckMatch = pathname.match(/^\/api\/admin\/billing\/alerts\/([^/]+)\/ack$/);
    if (postgresBilling && alertAckMatch && req.method === "POST") {
      await postgresBilling.ackAlert(alertAckMatch[1], (requestIdentity && requestIdentity.sub) || "admin");
      await postgresBilling.writeAdminAudit({ actor: (requestIdentity && requestIdentity.sub) || "admin", action: "alert.ack", targetType: "platform_alert", targetId: alertAckMatch[1], summary: "管理员确认异常告警", ip: req.socket.remoteAddress });
    }
    if (postgresBilling && pathname === "/api/admin/audits" && req.method === "GET") {
      return sendJSON(res, 200, await postgresBilling.listAdminAuditLogs({ limit: Number(url.searchParams.get("limit")) || 200, search: url.searchParams.get("search") || null }));
    }

    // PostgreSQL 模式下，管理后台密钥也必须走业务库，不能退回服务器 JSON 文件。
    if (postgresBilling && pathname === "/api/admin/api-keys" && req.method === "GET") {
      return sendJSON(res, 200, (await postgresBilling.listPlatformApiKeys()).map(publicApiKey));
    }
    if (postgresBilling && pathname === "/api/admin/api-keys" && req.method === "POST") {
      const body = await parseBody(req);
      const created = await postgresBilling.createPlatformApiKey(body);
      void postgresBilling.writeAdminAudit({ actor: (requestIdentity && requestIdentity.sub) || "admin", action: "api_key.create", targetType: "platform_key", targetId: String(created.id), summary: `新增渠道密钥：${created.name||""}`, metadata: { name: created.name, base_url: created.base_url }, ip: req.socket.remoteAddress }).catch(()=>{});
      return sendJSON(res, 200, publicApiKey(created));
    }
    const pgPutKey = pathname.match(/^\/api\/admin\/api-keys\/([^/]+)$/);
    if (postgresBilling && pgPutKey && req.method === "PUT") {
      const body = await parseBody(req);
      keys = await postgresBilling.listPlatformApiKeys();
      const updated = await postgresBilling.updatePlatformApiKey(pgPutKey[1], body);
      keys = await postgresBilling.listPlatformApiKeys();
      void postgresBilling.writeAdminAudit({ actor: (requestIdentity && requestIdentity.sub) || "admin", action: "api_key.update", targetType: "platform_key", targetId: pgPutKey[1], summary: `修改渠道密钥：${updated.name||""}`, metadata: { fields: Object.keys(body) }, ip: req.socket.remoteAddress }).catch(()=>{});
      return sendJSON(res, 200, publicApiKey(updated));
    }
    const pgDeleteKey = pathname.match(/^\/api\/admin\/api-keys\/([^/]+)$/);
    if (postgresBilling && pgDeleteKey && req.method === "DELETE") {
      const result = await postgresBilling.deletePlatformApiKey(pgDeleteKey[1]);
      keys = await postgresBilling.listPlatformApiKeys();
      void postgresBilling.writeAdminAudit({ actor: (requestIdentity && requestIdentity.sub) || "admin", action: "api_key.delete", targetType: "platform_key", targetId: pgDeleteKey[1], summary: "删除渠道密钥", ip: req.socket.remoteAddress }).catch(()=>{});
      return sendJSON(res, 200, result);
    }
    const pgFullKey = pathname.match(/^\/api\/admin\/api-keys\/([^/]+)\/full$/);
    if (postgresBilling && pgFullKey && req.method === "GET") {
      void postgresBilling.writeAdminAudit({ actor: (requestIdentity && requestIdentity.sub) || "admin", action: "api_key.view_secret", targetType: "platform_key", targetId: pgFullKey[1], summary: "查看渠道密钥明文", ip: req.socket.remoteAddress }).catch(()=>{});
      return sendJSON(res, 200, await postgresBilling.getPlatformApiKeySecret(pgFullKey[1]));
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

    // ===== 模型目录接口 =====
    // GET /api/admin/models-catalog — 模型目录列表
    if (pathname === "/api/admin/models-catalog" && req.method === "GET") {
      if (postgresBilling) return sendJSON(res, 200, await postgresBilling.listModelCatalog());
      return sendJSON(res, 200, modelsCatalog);
    }

    const catalogChannelModelsMatch = pathname.match(/^\/api\/admin\/models-catalog\/(\d+)\/channels$/);
    if (catalogChannelModelsMatch && req.method === "POST") {
      const body = await parseBody(req);
      if (postgresBilling) {
        try { return sendJSON(res, 201, await postgresBilling.addModelCatalogChannelModel(catalogChannelModelsMatch[1], body)); }
        catch (error) { return sendJSON(res, 400, { error: error.message }); }
      }
      const catalog = modelsCatalog.find(model => Number(model.id) === Number(catalogChannelModelsMatch[1]));
      const channel = keys.find(key => String(key.id) === String(body.channelId));
      const modelName = String(body.upstreamModelId || '').trim();
      if (!catalog) return sendJSON(res, 404, { error: "模型目录不存在" });
      if (!channel || !(channel.model || '').split(',').map(value => value.trim()).includes(modelName)) return sendJSON(res, 400, { error: "请选择该渠道已配置的模型" });
      const format = value => String(value).toLowerCase() === 'gemini' ? 'gemini' : 'openai';
      if ((catalog.linkedModels || []).some(link => {
        const linkedChannel = keys.find(key => String(key.id) === String(link.channelId));
        return linkedChannel && format(linkedChannel.provider) !== format(channel.provider);
      })) return sendJSON(res, 400, { error: "同一目录模型只能关联相同请求协议的渠道" });
      catalog.linkedModels ||= [];
      let link = catalog.linkedModels.find(item => String(item.channelId) === String(channel.id) && item.model === modelName);
      if (link) { link.isActive = true; link.priority = Number(body.priority) || 0; }
      else { link = { id: crypto.randomUUID(), channelId: channel.id, model: modelName, priority: Number(body.priority) || 0, isActive: true }; catalog.linkedModels.push(link); }
      saveJSON(MODELS_CATALOG_FILE, modelsCatalog);
      return sendJSON(res, 201, link);
    }
    const catalogChannelModelDeleteMatch = pathname.match(/^\/api\/admin\/models-catalog\/(\d+)\/channels\/([^/]+)$/);
    if (catalogChannelModelDeleteMatch && req.method === "DELETE") {
      if (postgresBilling) {
        try { return sendJSON(res, 200, await postgresBilling.removeModelCatalogChannelModel(catalogChannelModelDeleteMatch[1], catalogChannelModelDeleteMatch[2])); }
        catch (error) { return sendJSON(res, 404, { error: error.message }); }
      }
      const catalog = modelsCatalog.find(model => Number(model.id) === Number(catalogChannelModelDeleteMatch[1]));
      if (!catalog) return sendJSON(res, 404, { error: "模型目录不存在" });
      catalog.linkedModels = (catalog.linkedModels || []).filter(link => String(link.id) !== catalogChannelModelDeleteMatch[2]);
      saveJSON(MODELS_CATALOG_FILE, modelsCatalog);
      return sendJSON(res, 200, { success: true });
    }


    // POST /api/admin/models-catalog — 新增单个模型
    if (pathname === "/api/admin/models-catalog" && req.method === "POST") {
      const body = await parseBody(req);
      if (postgresBilling) {
        try { return sendJSON(res, 201, await postgresBilling.createModelCatalog(body)); }
        catch (error) { return sendJSON(res, 400, { error: error.message }); }
      }
      if (!String(body.displayName || '').trim()) return sendJSON(res, 400, { error: "请输入模型显示名称" });
      const newModel = {
        id: nextId(),
        modelId: null,
        displayName: String(body.displayName).trim(),
        provider: "unknown",
        capability: body.capability || "text",
        visible: body.visible !== false,
        sortOrder: modelsCatalog.length + 1,
        linkedModels: [],
        createdAt: Date.now(),
      };
      modelsCatalog.push(newModel);
      saveJSON(MODELS_CATALOG_FILE, modelsCatalog);
      return sendJSON(res, 201, newModel);
    }
    // POST /api/admin/models-catalog/bulk — 批量添加模型（已存在的跳过）
    if (pathname === "/api/admin/models-catalog/bulk" && req.method === "POST") {
      const body = await parseBody(req);
      if (postgresBilling) {
        try { return sendJSON(res, 200, await postgresBilling.bulkCreateModelCatalog(body.models || [])); }
        catch (error) { return sendJSON(res, 400, { error: error.message }); }
      }
      const models = body.models || [];
      let added = 0;
      for (const m of models) {
        if (!m.modelId) continue;
        // 已存在就跳过
        if (modelsCatalog.find(existing => existing.modelId === m.modelId)) continue;
        modelsCatalog.push({
          id: nextId(),
          modelId: m.modelId,
          displayName: m.displayName || m.modelId,
          provider: m.provider || "unknown",
          capability: m.capability || "text",
          visible: m.visible !== false,
          sortOrder: modelsCatalog.length + 1,
          createdAt: Date.now(),
        });
        added++;
      }
      saveJSON(MODELS_CATALOG_FILE, modelsCatalog);
      return sendJSON(res, 200, { added, total: modelsCatalog.length });
    }

    // PUT /api/admin/models-catalog/:id — 更新单个模型
    const catalogPutMatch = pathname.match(/^\/api\/admin\/models-catalog\/(\d+)$/);
    if (catalogPutMatch && req.method === "PUT") {
      const id = parseInt(catalogPutMatch[1], 10);
      if (postgresBilling) {
        try { return sendJSON(res, 200, await postgresBilling.updateModelCatalog(id, await parseBody(req))); }
        catch (error) { return sendJSON(res, error.message === '模型不存在' ? 404 : 400, { error: error.message }); }
      }
      const idx = modelsCatalog.findIndex(m => m.id === id);
      if (idx === -1) return sendJSON(res, 404, { error: "模型不存在" });
      const body = await parseBody(req);
      if (body.displayName !== undefined) modelsCatalog[idx].displayName = body.displayName;
      if (body.capability !== undefined) modelsCatalog[idx].capability = body.capability;
      if (body.visible !== undefined) modelsCatalog[idx].visible = !!body.visible;
      if (body.sortOrder !== undefined) modelsCatalog[idx].sortOrder = Number(body.sortOrder);
      saveJSON(MODELS_CATALOG_FILE, modelsCatalog);
      return sendJSON(res, 200, modelsCatalog[idx]);
    }

    // DELETE /api/admin/models-catalog/:id — 删除模型
    const catalogDelMatch = pathname.match(/^\/api\/admin\/models-catalog\/(\d+)$/);
    if (catalogDelMatch && req.method === "DELETE") {
      const id = parseInt(catalogDelMatch[1], 10);
      if (postgresBilling) {
        try { return sendJSON(res, 200, await postgresBilling.deleteModelCatalog(id)); }
        catch (error) { return sendJSON(res, error.message === '模型不存在' ? 404 : 400, { error: error.message }); }
      }
      modelsCatalog = modelsCatalog.filter(m => m.id !== id);
      saveJSON(MODELS_CATALOG_FILE, modelsCatalog);
      return sendJSON(res, 200, { success: true });
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

    // GET /api/admin/api-keys/:id/usage — 渠道调用明细（管理员可见）
    const keyUsageMatch = pathname.match(/^\/api\/admin\/api-keys\/([0-9a-f-]{36})\/usage$/i);
    if (keyUsageMatch && req.method === "GET") {
      if (!postgresBilling) return sendJSON(res, 503, { error: "当前存储未提供可追溯的调用记录" });
      try {
        return sendJSON(res, 200, await postgresBilling.listPlatformApiKeyUsage(keyUsageMatch[1], {
          range: url.searchParams.get("range") || "today",
          capability: url.searchParams.get("capability") || "全部",
          limit: url.searchParams.get("limit"),
          offset: url.searchParams.get("offset"),
        }));
      } catch (error) { return sendJSON(res, 400, { error: error.message || "读取调用明细失败" }); }
    }

    // GET /api/admin/key-stats — 密钥使用统计
    if (pathname === "/api/admin/key-stats" && req.method === "GET") {
      if (postgresBilling) return sendJSON(res, 200, await postgresBilling.listPlatformApiKeyStats());
      const stats = {};
      keys.forEach(k => { stats[k.id] = { success: 0, failure: 0, total: 0 }; });
      return sendJSON(res, 200, stats);
    }

    // GET /api/admin/key-history — 密钥使用历史
    if (pathname === "/api/admin/key-history" && req.method === "GET") {
      if (postgresBilling) return sendJSON(res, 200, await postgresBilling.listPlatformApiKeyHistory());
      const history = {};
      keys.forEach(k => { history[k.id] = []; });
      return sendJSON(res, 200, history);
    }

    // POST /api/admin/change-password — 修改密码
    if (pathname === "/api/admin/change-password" && req.method === "POST") {
      const body = await parseBody(req);
      if (!body || typeof body.newPassword !== "string" || body.newPassword.length < 6 || body.newPassword.length > 1024) {
        return sendJSON(res, 400, { error: "新密码长度必须为 6 至 1024 个字符" });
      }
      if (typeof body.confirmPassword !== "string" || body.newPassword !== body.confirmPassword) {
        return sendJSON(res, 400, { error: "两次输入的新密码不一致" });
      }
      const oldPassword = typeof body.oldPassword === "string" ? body.oldPassword : "";
      const newHash = await hashPassword(body.newPassword);
      if (postgresBilling) {
        const username = requestIdentity?.sub || "";
        const account = await postgresBilling.getAdminAccount(username);
        if (!account || account.status !== "active" || !await verifyAdminPassword(oldPassword, account.password_hash)) {
          return sendJSON(res, 400, { error: "原密码错误" });
        }
        const changed = await postgresBilling.changeAdminPassword(username, account.password_hash, newHash);
        if (!changed) return sendJSON(res, 409, { error: "密码已在其他操作中更新，请重新验证后重试" });
      } else {
        const currentHash = admin.password;
        if (!await verifyAdminPassword(oldPassword, currentHash)) return sendJSON(res, 400, { error: "原密码错误" });
        if (admin.password !== currentHash) return sendJSON(res, 409, { error: "密码已在其他操作中更新，请重新验证后重试" });
        admin.password = newHash;
        saveJSON(ADMIN_FILE, admin);
      }
      return sendJSON(res, 200, { success: true });
    }

    // 404
    return sendJSON(res, 404, { error: "接口不存在: " + pathname });

  } catch (err) {
    console.error("[server error]", err);
    if (!res.headersSent) sendJSON(res, 500, { error: "服务器内部错误: " + err.message });
  }
});

server.listen(PORT, API_HOST, () => {
  // 0046：每 30 秒回收超时在途任务并释放过期预扣额度；发现守恒异常自动写告警。
  if (postgresBilling) {
    const fileRecoveryWorkerId = `${os.hostname()}:${process.pid}`;
    setInterval(async () => {
      try {
        const jobs = await postgresBilling.claimFileUploadRecoveryJobs(fileRecoveryWorkerId, 10);
        for (const job of jobs) setImmediate(() => processFileUploadRecoveryJob(job));
        if (jobs.length) console.log('[file-recovery] claimed', jobs.length);
      } catch (error) { console.error('[file-recovery] claim failed', error.message); }
    }, 15000).unref?.();

    setInterval(() => {
      postgresBilling.reapStaleTasks()
        .then(r => { if ((r.refunded_tasks||0) > 0 || (r.expired_quota_reservations||0) > 0) console.log("[reaper]", JSON.stringify(r)); })
        .catch(e => console.error("[reaper] failed", e.message));
    }, 30000).unref?.();

    // 支付事件先持久化，再按退避时间重试；达到次数上限会产生后台告警。
    setInterval(() => {
      postgresBilling.processRecoverablePaymentEvents(20)
        .then(r => { if (r.claimed > 0) console.log("[payment-retry]", JSON.stringify(r)); })
        .catch(e => console.error("[payment-retry] failed", e.message));
    }, 30000).unref?.();

    // 启动恢复：上次进程崩溃/重启时还在 pending 的任务，重新派发给 worker，
    // 不要让它们干等到 timeout_at 才被 reaper 退款。
    (async () => {
      try {
        const recoverable = await postgresBilling.listRecoverableTasks(50);
        for (const { task, appwriteUserId, attemptId, providerTaskId } of recoverable) {
          const catalogModelId = Number(task.parameters?.__qingyuCatalogModelId) || null;
          const match = await findChannelForModel(catalogModelId ? `catalog:${catalogModelId}` : (task.model || ""));
          if (!match) { console.error("[recover] no channel for task", task.id, task.model); continue; }
          const bodyObj = task.parameters && typeof task.parameters === "object" ? task.parameters : {};
          if (match.catalogModelId) bodyObj.model = match.model;
          const identity = { sub: appwriteUserId, role: "customer" };
          // 串行派发，避免启动瞬间打满上游；每个任务内部独立 try/catch。
          if (['video','audio'].includes(task.taskType)) {
            setImmediate(() => runGenerationTaskMediaWorker(identity, task, match.channel, bodyObj, { attemptId, providerTaskId }));
          } else {
            setImmediate(() => runGenerationTaskWorker(identity, task, match.channel, bodyObj));
          }
        }
        if (recoverable.length) console.log("[recover] resumed", recoverable.length, "pending tasks");
      } catch (e) { console.error("[recover] failed", e.message); }
    })();
  }

  console.log(`[qingyu-api] 服务已启动，端口 ${PORT}`);
  console.log(`[qingyu-api] 数据目录: ${DATA_DIR}`);
  console.log(`[qingyu-api] 活跃密钥: ${keys.filter(k => k.is_active === 1).length} 个`);
});
