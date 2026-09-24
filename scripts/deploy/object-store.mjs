/**
 * 对象存储抽象层（P1：local 本地磁盘；P2 接 S3 兼容协议如腾讯云 COS / 阿里云 OSS / Cloudflare R2）
 *
 * 设计原则：
 * - 业务代码只依赖 putObject / createReadStream / signReadUrl 三个接口，不关心底层落在哪
 * - provider 由环境变量 OBJECT_STORAGE_PROVIDER 切换：local（默认）| s3
 * - P1 保持零依赖：local provider 只用 node:fs；s3 adapter 等 P2 真接 COS 时再加
 *
 * key 命名约定：
 * - 用户上传素材：{appwriteUserId}/{uuid}.{ext}        （旧逻辑，api-server.mjs 里）
 * - AI 生成结果：gen/{taskId}/{index}.{ext}           （新增）
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function createObjectStore({ dataDir, env = process.env }) {
  const provider = String(env.OBJECT_STORAGE_PROVIDER || "local").toLowerCase();
  const bucket = String(env.OBJECT_STORAGE_BUCKET || "qingyu-assets");
  const rootDir = path.resolve(dataDir);
  if (!fs.existsSync(rootDir)) fs.mkdirSync(rootDir, { recursive: true });

  // ── local provider ──────────────────────────────────────────────────────
  async function putObjectLocal({ key, buffer, contentType }) {
    const abs = path.join(rootDir, key);
    const parent = path.dirname(abs);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    // 0o600：对象文件包含用户隐私图，仅进程可读
    await fs.promises.writeFile(abs, buffer, { mode: 0o600 });
    return {
      storageProvider: "local",
      bucket,
      objectKey: key,
      sizeBytes: buffer.length,
      sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      contentType: contentType || "application/octet-stream",
    };
  }

  function createReadStreamLocal(objectKey) {
    // 防目录穿越：必须 resolve 后仍在 rootDir 下
    const abs = path.resolve(rootDir, objectKey);
    const rootResolved = path.resolve(rootDir);
    if (!abs.startsWith(rootResolved + path.sep) && abs !== rootResolved) {
      throw new Error("非法对象路径");
    }
    return fs.createReadStream(abs);
  }

  function statLocal(objectKey) {
    const abs = path.resolve(rootDir, objectKey);
    const rootResolved = path.resolve(rootDir);
    if (!abs.startsWith(rootResolved + path.sep)) throw new Error("非法对象路径");
    return fs.statSync(abs);
  }

  // ── s3 provider（P2 占位，未配置即报错，避免静默落错地方）─────────────
  async function putObjectS3() {
    throw new Error("OBJECT_STORAGE_PROVIDER=s3 尚未接入，请保持 local 或等待 P2 完成");
  }

  return {
    provider,
    bucket,
    async putObject(input) {
      if (provider === "local") return putObjectLocal(input);
      return putObjectS3(input);
    },
    createReadStream(objectKey) {
      if (provider !== "local") throw new Error("当前存储提供商暂不支持直接流式读取");
      return createReadStreamLocal(objectKey);
    },
    stat(objectKey) {
      if (provider !== "local") throw new Error("当前存储提供商暂不支持 stat");
      return statLocal(objectKey);
    },
    /**
     * 私有桶读链接。local 模式下返回 null——让前端走后端代理接口
     * /api/generation-tasks/:id/outputs/:index/content（后端校验权限后再流回）。
     * P2 接 S3 时这里返回带签名的临时 URL。
     */
    signReadUrl(objectKey, expiresInSec = 3600) {
      if (provider === "local") return null;
      throw new Error("s3 signReadUrl 尚未实现");
    },
  };
}

// 根据 buffer 头猜 mime，避免依赖外部探测库。
// 只覆盖常见生图格式；其他一律按 octet-stream，前端再兜底。
export function sniffImageMime(buffer) {
  if (!buffer || buffer.length < 12) return "application/octet-stream";
  // ffd8ffe0 / ffd8ffe1 / ffd8ffe8 → jpeg
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  // 89 50 4e 47 0d 0a 1a 0a → png
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  // 47 49 46 38 → gif
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return "image/gif";
  // 52 49 46 46 ?? ?? ?? ?? 57 45 42 50 → webp
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return "image/webp";
  // 66 74 79 70 61 76 69 66 → avif（在 4..12 范围）
  if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70 &&
      buffer[8] === 0x61 && buffer[9] === 0x76 && buffer[10] === 0x69 && buffer[11] === 0x66) return "image/avif";
  return "application/octet-stream";
}

export function extForMime(mime) {
  switch (mime) {
    case "image/jpeg": return ".jpg";
    case "image/png": return ".png";
    case "image/gif": return ".gif";
    case "image/webp": return ".webp";
    case "image/avif": return ".avif";
    default: return ".bin";
  }
}
