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
const PORT = process.env.PORT || 3001;

// ---------- 数据存储 ----------
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); }
  catch { return fallback; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
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
        const token = signJWT({ sub: admin.username, iat: Math.floor(Date.now() / 1000), exp });
        return sendJSON(res, 200, { token });
      }
      return sendJSON(res, 401, { error: "用户名或密码错误" });
    }

    // ===== 管理接口（需认证）=====
    if (pathname.startsWith("/api/admin/") && pathname !== "/api/admin/login") {
      if (!verifyToken(req)) {
        return sendJSON(res, 401, { error: "未登录或登录已过期" });
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
